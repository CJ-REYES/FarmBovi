import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { BaseTransactionalRepository } from './base-transactional.repository';
import { OutboxRepository } from './outbox.repository';
import type { LocalOutboxQueue, LocalReproductionRecord } from '../schema';
import type { BackendEventoReproductivoDto } from '../../../types/reproduction';

function compareReproductionChronologically(
  a: LocalReproductionRecord,
  b: LocalReproductionRecord,
  order: 'asc' | 'desc' = 'desc'
): number {
  const timeA = Date.parse(a.fecha);
  const timeB = Date.parse(b.fecha);
  let diff =
    !Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB
      ? timeA - timeB
      : a.fecha.localeCompare(b.fecha);

  if (diff === 0) {
    diff = a.createdAt.localeCompare(b.createdAt);
  }
  if (diff === 0) {
    diff = a.id.localeCompare(b.id);
  }

  return order === 'asc' ? diff : -diff;
}

export interface ReproductionQueryOptions {
  ranchId?: string;
  allowedRanchIds?: readonly string[];
  cattleId?: string;
  tipo?: string;
  desde?: string;
  hasta?: string;
  includeDeleted?: boolean;
  order?: 'asc' | 'desc';
}

class ReproductionTransactionalRepository extends BaseTransactionalRepository<LocalReproductionRecord> {
  constructor() {
    super('reproductionRecords', db.reproductionRecords);
  }

  async getAllWithOptions(options?: ReproductionQueryOptions): Promise<LocalReproductionRecord[]> {
    let items: LocalReproductionRecord[];
    if (options?.cattleId) {
      items = await db.reproductionRecords.where('cattleId').equals(options.cattleId).toArray();
    } else if (options?.ranchId) {
      items = await db.reproductionRecords.where('ranchId').equals(options.ranchId).toArray();
    } else {
      items = await db.reproductionRecords.toArray();
    }

    if (options?.ranchId) {
      items = items.filter((r) => r.ranchId === options.ranchId);
    } else if (options?.allowedRanchIds && options.allowedRanchIds.length > 0) {
      const allowed = new Set(options.allowedRanchIds);
      items = items.filter((r) => Boolean(r.ranchId && allowed.has(r.ranchId)));
    }

    if (!options?.includeDeleted) {
      items = items.filter((r) => !r.deletedAt);
    }

    if (options?.tipo && options.tipo.trim().length > 0) {
      const normalizedTipo = options.tipo.trim().toLowerCase();
      items = items.filter((r) => r.evento.trim().toLowerCase() === normalizedTipo);
    }

    if (options?.desde && options.desde.trim().length > 0) {
      const fromMs = Date.parse(options.desde.trim());
      if (!Number.isNaN(fromMs)) {
        items = items.filter((r) => {
          const itemMs = Date.parse(r.fecha);
          return !Number.isNaN(itemMs) && itemMs >= fromMs;
        });
      }
    }

    if (options?.hasta && options.hasta.trim().length > 0) {
      const toMs = Date.parse(options.hasta.trim());
      if (!Number.isNaN(toMs)) {
        items = items.filter((r) => {
          const itemMs = Date.parse(r.fecha);
          return !Number.isNaN(itemMs) && itemMs <= toMs;
        });
      }
    }

    return items.sort((a, b) =>
      compareReproductionChronologically(a, b, options?.order ?? 'desc')
    );
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalReproductionRecord | undefined> {
    const direct = await db.reproductionRecords.get(id);
    if (direct) return direct;
    return await db.reproductionRecords.where('remoteId').equals(id).first();
  }

  async getByCattleId(cattleId: string): Promise<LocalReproductionRecord[]> {
    return await this.getAllWithOptions({
      cattleId,
      includeDeleted: false,
      order: 'desc'
    });
  }

  /**
   * Actualiza un evento reproductivo local y, si tenía operaciones previas en estado `fallido`
   * (por ejemplo, un error de validación devuelto por el servidor), las reemplaza de forma
   * atómica por una operación limpia (`CREATE` si nunca fue confirmado en el servidor, o
   * `UPDATE` con `versionBase` actual si ya existe remotamente), permitiendo recuperar el error.
   */
  async updateRecoverable(
    id: string,
    changes: Partial<LocalReproductionRecord>,
    payload: unknown
  ): Promise<LocalReproductionRecord> {
    const existing = await this.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('Registro no encontrado en reproductionRecords para actualización.');
    }

    const entityOps = await db.outbox
      .where('idEntidad')
      .equals(existing.id)
      .filter((op) => op.entidad === 'reproductionRecords' && op.estado !== 'confirmado')
      .toArray();

    const hasFailedOps =
      existing.syncStatus === 'error' || entityOps.some((op) => op.estado === 'fallido');

    if (!hasFailedOps) {
      return await this.update(existing.id, changes, payload);
    }

    return await db.transaction(
      'rw',
      [db.reproductionRecords, db.outbox, db.syncConflicts],
      async () => {
        const fresh = await db.reproductionRecords.get(existing.id);
        if (!fresh || fresh.deletedAt) {
          throw new Error('El evento reproductivo ya no está activo para edición.');
        }

        const now = new Date().toISOString();
        const hasConfirmedServerSync =
          Boolean(fresh.remoteId) ||
          (fresh.serverVersion !== null && fresh.serverVersion !== undefined);

        const updatedEntity: LocalReproductionRecord = {
          ...fresh,
          ...changes,
          id: fresh.id,
          localNumericId: fresh.localNumericId ?? computeStableNegativeId(fresh.id),
          updatedAt: now,
          syncStatus: 'pending'
        };

        await db.reproductionRecords.put(updatedEntity);

        const unconfirmedIds = entityOps.map((op) => op.idOperacion);
        if (unconfirmedIds.length > 0) {
          await db.outbox.bulkDelete(unconfirmedIds);
        }

        const nextOp: LocalOutboxQueue = {
          ...OutboxRepository.createOperationRecord({
            entidad: 'reproductionRecords',
            idEntidad: fresh.id,
            tipoOperacion: hasConfirmedServerSync ? 'UPDATE' : 'CREATE',
            versionBase: hasConfirmedServerSync ? (fresh.serverVersion ?? null) : null,
            payload,
            idRancho: (changes.ranchId ?? fresh.ranchId) ?? null
          }),
          fechaCreacion: now
        };

        await db.outbox.put(nextOp);
        return updatedEntity;
      }
    );
  }

  /**
   * Reconcilia la lista devuelta por `GET /api/eventos-reproductivos` contra IndexedDB:
   * - Evita duplicados vinculando por `remoteId` o `id` local.
   * - Nunca sobrescribe registros locales con cambios pendientes, en error o en conflicto.
   * - Si se consultó un alcance sin filtros parciales (`!tipo && !desde && !hasta`) y con
   *   `includeDeleted === false`, marca como desactivados lógicamente los registros `synced`
   *   de ese alcance que ya no figuran activos en el servidor.
   */
  async reconcileServerSnapshot(
    remoteItems: BackendEventoReproductivoDto[],
    ranchByAnimal: ReadonlyMap<string, string>,
    options?: {
      scopedRanchId?: string;
      allowedRanchIds?: readonly string[];
      scopedCattleId?: string;
      includeDeleted?: boolean;
      isFilteredSubset?: boolean;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    const remoteIdsSeen = new Set(remoteItems.map((r) => r.idEventoReproductivo));

    await db.transaction('rw', [db.reproductionRecords, db.outbox], async () => {
      const localAll = await db.reproductionRecords.toArray();
      const unconfirmedEntityIds = new Set(
        (
          await db.outbox
            .where('entidad')
            .equals('reproductionRecords')
            .filter((op) => op.estado !== 'confirmado')
            .toArray()
        ).map((op) => op.idEntidad)
      );

      const byId = new Map<string, LocalReproductionRecord>();
      const byRemoteId = new Map<string, LocalReproductionRecord>();
      for (const local of localAll) {
        byId.set(local.id, local);
        if (typeof local.remoteId === 'string') {
          byRemoteId.set(local.remoteId, local);
        }
      }

      for (const remote of remoteItems) {
        const existing =
          byRemoteId.get(remote.idEventoReproductivo) ?? byId.get(remote.idEventoReproductivo);

        if (
          existing &&
          (existing.syncStatus !== 'synced' || unconfirmedEntityIds.has(existing.id))
        ) {
          continue;
        }

        const stableId = existing?.id ?? remote.idEventoReproductivo;
        const resolvedRanch = ranchByAnimal.get(remote.idAnimal) ?? existing?.ranchId;

        await db.reproductionRecords.put({
          id: stableId,
          localNumericId: existing?.localNumericId ?? computeStableNegativeId(stableId),
          remoteId: remote.idEventoReproductivo,
          ranchId: resolvedRanch,
          cattleId: remote.idAnimal,
          sementalId: remote.idSemental ?? null,
          evento: remote.tipo.trim(),
          fecha: remote.fecha,
          resultado: remote.resultado?.trim() ? remote.resultado.trim() : null,
          observaciones: remote.observaciones?.trim() ? remote.observaciones.trim() : undefined,
          createdAt: remote.creadoEn || existing?.createdAt || now,
          updatedAt: now,
          syncStatus: 'synced',
          serverVersion: remote.versionRegistro ?? 1,
          deletedAt: remote.eliminadoEn ?? null
        });
      }

      if (!options?.includeDeleted && !options?.isFilteredSubset) {
        const allowedSet =
          options?.allowedRanchIds && options.allowedRanchIds.length > 0
            ? new Set(options.allowedRanchIds)
            : null;

        for (const local of localAll) {
          if (local.deletedAt || local.syncStatus !== 'synced') continue;
          if (unconfirmedEntityIds.has(local.id)) continue;

          if (options?.scopedCattleId && local.cattleId !== options.scopedCattleId) continue;
          if (options?.scopedRanchId && local.ranchId !== options.scopedRanchId) continue;
          if (allowedSet && local.ranchId && !allowedSet.has(local.ranchId)) continue;

          const effectiveRemoteId =
            typeof local.remoteId === 'string' ? local.remoteId : local.id;
          if (!remoteIdsSeen.has(effectiveRemoteId)) {
            await db.reproductionRecords.update(local.id, {
              deletedAt: now,
              updatedAt: now,
              syncStatus: 'synced'
            });
          }
        }
      }
    });
  }
}

export const ReproductionRepository = new ReproductionTransactionalRepository();
