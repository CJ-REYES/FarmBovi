import type { Table, UpdateSpec } from 'dexie';
import { db } from '../../lib/database/db';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import type {
  BaseLocalEntity,
  ConflictType,
  LocalOutboxQueue,
  LocalSyncCheckpoint,
  LocalSyncConflict,
  SyncEntityName
} from '../../lib/database/schema';
import type { SyncPullResponseDto, SyncRemoteChangeItemDto } from '../../types/sync-contracts';
import { SyncHttpClient } from './sync-http.client';
import { getSyncEntityTable, mapRemoteChangeToLocalEntity } from './sync-pull.mapper';

export type PullEntityStatus =
  | 'completed'
  | 'already_running'
  | 'offline'
  | 'endpoint_not_configured'
  | 'pagination_stalled'
  | 'transaction_failed';

export interface PullEntitySummary {
  entidad: SyncEntityName;
  status: PullEntityStatus;
  pagesProcessed: number;
  appliedCount: number;
  deletedCount: number;
  conflictCount: number;
  skippedPendingCount: number;
  previousCursor: string | null;
  currentCursor: string | null;
  errorMessage?: string;
}

export interface PullOptions {
  pageSize?: number;
  ranchId?: string;
  maxPagesPerPass?: number;
}

/**
 * Orden topológico padre -> hijo limitado a las entidades habilitadas en `SyncController`
 * (`GET /api/sync/cambios`). Evita solicitudes 400 contra entidades aún no modeladas en Backend.
 */
export const PULL_ENTITY_ORDER: readonly SyncEntityName[] = [
  'lots',
  'cattle',
  'healthRecords',
  'feedingRecords',
  'movements',
  'alerts'
];

const inFlightPullEntities = new Set<SyncEntityName>();

function toRecordObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { valor: value };
}

interface BatchApplyMetrics {
  appliedCount: number;
  deletedCount: number;
  conflictCount: number;
  skippedPendingCount: number;
  committedCheckpoint: LocalSyncCheckpoint;
}

export const SyncPullEngine = {
  isEntityPulling(entidad: SyncEntityName): boolean {
    return inFlightPullEntities.has(entidad);
  },

  /**
   * Aplica un lote validado de cambios remotos y avanza el cursor opaco dentro de
   * una única transacción Dexie 'rw'. Si cualquier registro falla, IndexedDB revierte
   * todos los cambios del lote y conserva el cursor anterior.
   */
  async applyBatchAtomically(params: {
    entidad: SyncEntityName;
    response: SyncPullResponseDto<Record<string, unknown>>;
    currentCheckpoint?: LocalSyncCheckpoint;
  }): Promise<BatchApplyMetrics> {
    const entityTable = getSyncEntityTable(params.entidad);
    if (!entityTable) {
      throw new Error(`No existe tabla local configurada para la entidad ${params.entidad}.`);
    }

    const tables: Table<unknown, string>[] = [
      entityTable as unknown as Table<unknown, string>,
      db.outbox as unknown as Table<unknown, string>,
      db.syncConflicts as unknown as Table<unknown, string>,
      db.syncCheckpoints as unknown as Table<unknown, string>
    ];

    // Se incluyen tablas padre para resolver referencias remoteId -> UUID local en modo lectura
    if (params.entidad !== 'cattle') {
      tables.push(db.cattle as unknown as Table<unknown, string>);
    }
    if (params.entidad !== 'lots') {
      tables.push(db.lots as unknown as Table<unknown, string>);
    }

    return await db.transaction('rw', tables, async () => {
      let appliedCount = 0;
      let deletedCount = 0;
      let conflictCount = 0;
      let skippedPendingCount = 0;

      for (const change of params.response.cambios) {
        const existing = await this.findExistingLocalRecord(entityTable, change);
        const pendingOps = existing
          ? await this.findUnconfirmedOutboxOps(params.entidad, existing.id)
          : [];

        const hasPendingLocalChanges =
          Boolean(
            existing &&
              (existing.syncStatus === 'pending' ||
                existing.syncStatus === 'conflict' ||
                existing.syncStatus === 'error')
          ) || pendingOps.length > 0;

        const isRemoteDelete = change.eliminado === true || change.operacion === 'DELETE';

        if (hasPendingLocalChanges && existing) {
          const outcome = await this.handlePendingLocalCollision({
            entidad: params.entidad,
            entityTable,
            existing,
            pendingOps,
            change,
            isRemoteDelete
          });

          if (outcome === 'conflict_recorded') {
            conflictCount++;
          } else if (outcome === 'convergent_delete_confirmed') {
            deletedCount++;
          } else {
            skippedPendingCount++;
          }
          continue;
        }

        if (isRemoteDelete) {
          if (existing) {
            const tombstonePatch: Partial<BaseLocalEntity> = {
              remoteId: change.remoteId,
              deletedAt: existing.deletedAt || change.actualizadoEnServidor,
              updatedAt: change.actualizadoEnServidor,
              serverVersion: change.versionServidor,
              syncStatus: 'synced'
            };
            await entityTable.update(
              existing.id,
              tombstonePatch as unknown as UpdateSpec<BaseLocalEntity>
            );
            deletedCount++;
          }
          continue;
        }

        // UPSERT limpio sin mutaciones locales pendientes
        const mappedRecord = await mapRemoteChangeToLocalEntity(
          params.entidad,
          change,
          existing
        );
        await entityTable.put(mappedRecord);
        appliedCount++;
      }

      // Paso final dentro de la misma transacción: avanzar el cursor opaco
      const nextCheckpoint = CheckpointRepository.buildNextCheckpoint({
        entidad: params.entidad,
        currentCheckpoint: params.currentCheckpoint,
        siguienteCursorOpaco: params.response.siguienteCursorOpaco,
        fechaServidor: params.response.fechaServidor
      });

      await db.syncCheckpoints.put(nextCheckpoint);

      return {
        appliedCount,
        deletedCount,
        conflictCount,
        skippedPendingCount,
        committedCheckpoint: nextCheckpoint
      };
    });
  },

  async findExistingLocalRecord(
    entityTable: Table<BaseLocalEntity, string>,
    change: SyncRemoteChangeItemDto<Record<string, unknown>>
  ): Promise<BaseLocalEntity | undefined> {
    const byRemoteId = await entityTable.where('remoteId').equals(change.remoteId).first();
    if (byRemoteId) return byRemoteId;

    if (change.clientUuid) {
      const byClientUuid = await entityTable.get(change.clientUuid);
      if (byClientUuid) return byClientUuid;
    }

    return undefined;
  },

  async findUnconfirmedOutboxOps(
    entidad: SyncEntityName,
    idEntidad: string
  ): Promise<LocalOutboxQueue[]> {
    const ops = await db.outbox
      .where('idEntidad')
      .equals(idEntidad)
      .filter((op) => op.entidad === entidad && op.estado !== 'confirmado')
      .toArray();
    return ops.sort((a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion));
  },

  /**
   * Protege registros con mutaciones locales pendientes:
   * - Nunca sobrescribe los datos locales del usuario.
   * - Si la versión o eliminación remota difiere de la base local, registra un conflicto persistente.
   */
  async handlePendingLocalCollision(params: {
    entidad: SyncEntityName;
    entityTable: Table<BaseLocalEntity, string>;
    existing: BaseLocalEntity;
    pendingOps: LocalOutboxQueue[];
    change: SyncRemoteChangeItemDto<Record<string, unknown>>;
    isRemoteDelete: boolean;
  }): Promise<'conflict_recorded' | 'convergent_delete_confirmed' | 'preserved_pending'> {
    const { entidad, entityTable, existing, pendingOps, change, isRemoteDelete } = params;
    const headOp = pendingOps[0];

    // Caso convergente: ambos dispositivos eliminaron el mismo registro
    if (isRemoteDelete && (existing.deletedAt || headOp?.tipoOperacion === 'DELETE')) {
      const tombstonePatch: Partial<BaseLocalEntity> = {
        remoteId: change.remoteId,
        deletedAt: existing.deletedAt || change.actualizadoEnServidor,
        updatedAt: change.actualizadoEnServidor,
        serverVersion: change.versionServidor,
        syncStatus: 'synced'
      };
      await entityTable.update(
        existing.id,
        tombstonePatch as unknown as UpdateSpec<BaseLocalEntity>
      );

      for (const op of pendingOps) {
        if (op.tipoOperacion === 'DELETE') {
          await db.outbox.update(op.idOperacion, {
            estado: 'confirmado',
            ultimoError: null,
            proximoIntento: null
          });
        }
      }

      return 'convergent_delete_confirmed';
    }

    const baseVersion = existing.serverVersion ?? headOp?.versionBase ?? null;
    const hasVersionDivergence =
      isRemoteDelete ||
      baseVersion === null ||
      String(baseVersion) !== String(change.versionServidor);

    if (!hasVersionDivergence) {
      // Misma versión servidor conocida: conservar el cambio local pendiente intacto sin sobrescribir
      if (existing.remoteId === undefined || existing.remoteId === null) {
        const remoteIdPatch: Partial<BaseLocalEntity> = { remoteId: change.remoteId };
        await entityTable.update(
          existing.id,
          remoteIdPatch as unknown as UpdateSpec<BaseLocalEntity>
        );
      }
      return 'preserved_pending';
    }

    // Divergencia real: conservar ambas versiones (local intacta + remota en syncConflicts)
    const now = new Date().toISOString();
    const conflictType: ConflictType = isRemoteDelete
      ? 'DELETED_ON_SERVER'
      : 'VERSION_MISMATCH';

    const conflictMessage = isRemoteDelete
      ? 'El registro fue eliminado en otro dispositivo mientras tenía modificaciones locales pendientes.'
      : `Conflicto detectado durante descarga incremental: versión base local (${String(baseVersion)}) vs versión servidor (${String(change.versionServidor)}).`;

    const entityConflictPatch: Partial<BaseLocalEntity> = {
      remoteId: existing.remoteId ?? change.remoteId,
      syncStatus: 'conflict'
    };
    await entityTable.update(
      existing.id,
      entityConflictPatch as unknown as UpdateSpec<BaseLocalEntity>
    );

    const syntheticOperation: LocalOutboxQueue = headOp ?? {
      id: crypto.randomUUID(),
      idOperacion: crypto.randomUUID(),
      entidad,
      idEntidad: existing.id,
      tipoOperacion: existing.deletedAt ? 'DELETE' : 'UPDATE',
      versionBase: baseVersion,
      payload: existing,
      estado: 'conflicto',
      fechaCreacion: now,
      intentos: 0,
      ultimoError: conflictMessage,
      proximoIntento: null
    };

    if (headOp) {
      await db.outbox.update(headOp.idOperacion, {
        estado: 'conflicto',
        ultimoError: conflictMessage,
        proximoIntento: null
      });
    }

    const existingConflict = await db.syncConflicts
      .where('idOperacion')
      .equals(syntheticOperation.idOperacion)
      .first();

    const conflictRecord: LocalSyncConflict = {
      idConflicto: existingConflict?.idConflicto ?? crypto.randomUUID(),
      idOperacion: syntheticOperation.idOperacion,
      entidad,
      idEntidad: existing.id,
      remoteId: change.remoteId,
      operacionLocal: { ...syntheticOperation, estado: 'conflicto', ultimoError: conflictMessage },
      datosLocales: toRecordObject(headOp?.payload ?? existing),
      versionBase: baseVersion,
      estadoServidor: isRemoteDelete
        ? { ...(change.datos ?? {}), eliminado: true, remoteId: change.remoteId }
        : (change.datos ?? null),
      versionServidor: change.versionServidor,
      tipoConflicto: conflictType,
      estadoResolucion: 'pendiente',
      fechaDeteccion: existingConflict?.fechaDeteccion ?? now,
      fechaResolucion: null,
      notasResolucion: null
    };

    await db.syncConflicts.put(conflictRecord);
    return 'conflict_recorded';
  },

  /**
   * Descarga incrementalmente todas las páginas disponibles para una entidad
   * avanzando el cursor opaco página por página de manera atómica.
   */
  async pullEntity(
    entidad: SyncEntityName,
    options: PullOptions = {}
  ): Promise<PullEntitySummary> {
    const initialCheckpoint = await CheckpointRepository.getByEntity(entidad);
    const previousCursor = initialCheckpoint?.cursorOpaco ?? null;

    const summary: PullEntitySummary = {
      entidad,
      status: 'completed',
      pagesProcessed: 0,
      appliedCount: 0,
      deletedCount: 0,
      conflictCount: 0,
      skippedPendingCount: 0,
      previousCursor,
      currentCursor: previousCursor
    };

    if (inFlightPullEntities.has(entidad)) {
      summary.status = 'already_running';
      return summary;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      summary.status = 'offline';
      return summary;
    }

    const availability = SyncHttpClient.getEndpointAvailability();
    if (!availability.pullDisponible) {
      summary.status = 'endpoint_not_configured';
      return summary;
    }

    const pageSize = Math.min(500, Math.max(1, options.pageSize ?? 100));
    const maxPagesPerPass = Math.max(1, options.maxPagesPerPass ?? 50);

    inFlightPullEntities.add(entidad);

    try {
      let activeCheckpoint = initialCheckpoint;
      let requestCursor = activeCheckpoint?.cursorOpaco ?? null;
      let hasMorePages = true;

      while (hasMorePages && summary.pagesProcessed < maxPagesPerPass) {
        // 1. Solicitar lote posterior al último cursor opaco confirmado
        const response = await SyncHttpClient.fetchChanges<Record<string, unknown>>({
          entidad,
          cursorOpaco: requestCursor,
          limite: pageSize,
          ranchId: options.ranchId
        });

        // 2. Aplicar cambios y actualizar checkpoint en la misma transacción Dexie
        const batchMetrics = await this.applyBatchAtomically({
          entidad,
          response,
          currentCheckpoint: activeCheckpoint
        });

        summary.pagesProcessed++;
        summary.appliedCount += batchMetrics.appliedCount;
        summary.deletedCount += batchMetrics.deletedCount;
        summary.conflictCount += batchMetrics.conflictCount;
        summary.skippedPendingCount += batchMetrics.skippedPendingCount;

        activeCheckpoint = batchMetrics.committedCheckpoint;
        const nextCursor = activeCheckpoint.cursorOpaco;
        summary.currentCursor = nextCursor;

        // Protección contra paginación estancada del servidor
        if (response.hayMasPaginas && nextCursor === requestCursor) {
          summary.status = 'pagination_stalled';
          summary.errorMessage =
            'El servidor indicó hayMasPaginas=true sin avanzar siguienteCursorOpaco.';
          break;
        }

        requestCursor = nextCursor;
        hasMorePages = response.hayMasPaginas;
      }

      return summary;
    } catch (err) {
      // Si la transacción falló, activeCheckpoint conserva el último cursor comprometido
      const persistedAfterFailure = await CheckpointRepository.getByEntity(entidad);
      summary.status = 'transaction_failed';
      summary.currentCursor = persistedAfterFailure?.cursorOpaco ?? previousCursor;
      summary.errorMessage =
        err instanceof Error ? err.message : 'Error al procesar lote incremental.';
      return summary;
    } finally {
      inFlightPullEntities.delete(entidad);
    }
  },

  /**
   * Ejecuta la descarga incremental en orden topológico (catálogos padre antes que hijos).
   */
  async pullAllEntities(options: PullOptions = {}): Promise<PullEntitySummary[]> {
    const results: PullEntitySummary[] = [];
    for (const entidad of PULL_ENTITY_ORDER) {
      const entityResult = await this.pullEntity(entidad, options);
      results.push(entityResult);
      if (entityResult.status === 'offline' || entityResult.status === 'endpoint_not_configured') {
        break;
      }
    }
    return results;
  }
};
