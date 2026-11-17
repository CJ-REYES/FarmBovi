import type { Table, UpdateSpec } from 'dexie';
import { db } from '../../lib/database/db';
import type {
  BaseLocalEntity,
  LocalOutboxQueue,
  LocalSyncConflict,
  SyncEntityName
} from '../../lib/database/schema';
import {
  MAX_PUSH_RETRY_ATTEMPTS,
  OutboxRepository
} from '../../lib/database/repositories/outbox.repository';
import { SyncHttpClient } from './sync-http.client';
import type {
  SyncOperationRequestDto,
  SyncOperationResultDto
} from '../../types/sync-contracts';

export interface PushCycleSummary {
  status:
    | 'completed'
    | 'offline'
    | 'already_running'
    | 'backend_pending'
    | 'nothing_to_push';
  confirmedCount: number;
  alreadyProcessedCount: number;
  conflictCount: number;
  validationErrorCount: number;
  transientErrorCount: number;
  skippedBlockedByOrderCount: number;
}

/**
 * Orden de prioridad referencial para asegurar que entidades padre (lotes, bovinos)
 * se sincronicen antes que registros dependientes (pesajes, salud, movimientos).
 */
const ENTITY_SYNC_PRIORITY: Record<SyncEntityName, number> = {
  lots: 1,
  cattle: 2,
  genealogy: 3,
  movements: 4,
  weighings: 5,
  healthRecords: 6,
  feedingRecords: 7,
  reproductionRecords: 8,
  alerts: 9,
  media: 10,
  weighingAnalysisJobs: 11
};

const inFlightOperationIds = new Set<string>();
let activePushPromise: Promise<PushCycleSummary> | null = null;

function getEntityTable(entidad: SyncEntityName): Table<BaseLocalEntity, string> | null {
  switch (entidad) {
    case 'cattle':
      return db.cattle as unknown as Table<BaseLocalEntity, string>;
    case 'weighings':
      return db.weighings as unknown as Table<BaseLocalEntity, string>;
    case 'healthRecords':
      return db.healthRecords as unknown as Table<BaseLocalEntity, string>;
    case 'feedingRecords':
      return db.feedingRecords as unknown as Table<BaseLocalEntity, string>;
    case 'reproductionRecords':
      return db.reproductionRecords as unknown as Table<BaseLocalEntity, string>;
    case 'lots':
      return db.lots as unknown as Table<BaseLocalEntity, string>;
    case 'movements':
      return db.movements as unknown as Table<BaseLocalEntity, string>;
    case 'genealogy':
      return db.genealogy as unknown as Table<BaseLocalEntity, string>;
    case 'alerts':
      return db.alerts as unknown as Table<BaseLocalEntity, string>;
    case 'media':
      return db.media as unknown as Table<BaseLocalEntity, string>;
    case 'weighingAnalysisJobs':
      return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValidationErrorMessage(result: SyncOperationResultDto): string {
  const baseMessage =
    result.mensaje?.trim() || 'El servidor rechazó la operación por validación de datos.';

  if (!result.erroresCampos) {
    return baseMessage;
  }

  const details = Object.entries(result.erroresCampos)
    .flatMap(([field, errors]) =>
      Array.isArray(errors) ? errors.map((err) => `${field}: ${err}`) : []
    )
    .filter((entry) => entry.length > 0);

  if (details.length === 0) {
    return baseMessage;
  }

  return `${baseMessage} (${details.join('; ')})`;
}

export const PushSyncEngine = {
  /**
   * Espera progresiva exponencial con jitter acotado:
   * intento 0 -> ~2s, 1 -> ~4s, 2 -> ~8s, 3 -> ~16s, 4 -> ~32s, 5 -> ~64s, 6 -> ~128s... (tope 10 min)
   */
  calculateBackoffMs(attemptsAlreadyMade: number): number {
    const baseMs = 2000;
    const maxMs = 10 * 60 * 1000;
    const exponential = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attemptsAlreadyMade)));
    const jitter = Math.floor(Math.random() * 1000);
    return exponential + jitter;
  },

  isRunning(): boolean {
    return activePushPromise !== null;
  },

  isOperationInFlight(idOperacion: string): boolean {
    return inFlightOperationIds.has(idOperacion);
  },

  /**
   * Ejecuta un ciclo completo de sincronización saliente (Push) garantizando
   * exclusión mutua para evitar envíos paralelos duplicados.
   */
  async pushPendingOperations(): Promise<PushCycleSummary> {
    if (activePushPromise) {
      return await activePushPromise;
    }

    activePushPromise = this.executePushCycle().finally(() => {
      activePushPromise = null;
    });

    return await activePushPromise;
  },

  async executePushCycle(): Promise<PushCycleSummary> {
    const summary: PushCycleSummary = {
      status: 'completed',
      confirmedCount: 0,
      alreadyProcessedCount: 0,
      conflictCount: 0,
      validationErrorCount: 0,
      transientErrorCount: 0,
      skippedBlockedByOrderCount: 0
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ...summary, status: 'offline' };
    }

    // Recuperar operaciones que quedaron en 'en_proceso' tras un cierre inesperado
    await OutboxRepository.recoverInterruptedOperations(inFlightOperationIds);

    const dispatchableOps = await OutboxRepository.getDispatchableOperations();
    if (dispatchableOps.length === 0) {
      return { ...summary, status: 'nothing_to_push' };
    }

    // Verificar si el endpoint real de Push existe en el backend; nunca simular confirmación
    const availability = SyncHttpClient.getEndpointAvailability();
    if (!availability.pushDisponible) {
      return { ...summary, status: 'backend_pending' };
    }

    // Agrupar por entidad exacta `${entidad}:${idEntidad}` conservando orden cronológico estricto
    const entityStreams = new Map<string, LocalOutboxQueue[]>();
    for (const op of dispatchableOps) {
      const streamKey = `${op.entidad}:${op.idEntidad}`;
      const list = entityStreams.get(streamKey);
      if (list) {
        list.push(op);
      } else {
        entityStreams.set(streamKey, [op]);
      }
    }

    // Ordenar los flujos por prioridad referencial y por fecha de su primera operación
    const orderedStreams = Array.from(entityStreams.entries()).sort(([, opsA], [, opsB]) => {
      const prioA = ENTITY_SYNC_PRIORITY[opsA[0].entidad] ?? 99;
      const prioB = ENTITY_SYNC_PRIORITY[opsB[0].entidad] ?? 99;
      if (prioA !== prioB) return prioA - prioB;
      return opsA[0].fechaCreacion.localeCompare(opsB[0].fechaCreacion);
    });

    for (const [, streamOps] of orderedStreams) {
      const firstOp = streamOps[0];

      // Verificar si existen operaciones previas no confirmadas para la misma entidad
      // (ej. un conflicto abierto, un error de validación previo o un backoff pendiente)
      const allEntityOps = await OutboxRepository.getByEntity(firstOp.entidad, firstOp.idEntidad);
      const unconfirmedEntityOps = allEntityOps.filter((op) => op.estado !== 'confirmado');

      let blockedByEarlierUnconfirmed = false;

      for (const op of streamOps) {
        if (blockedByEarlierUnconfirmed) {
          summary.skippedBlockedByOrderCount++;
          continue;
        }

        // Si la primera operación no confirmada de esta entidad es distinta de `op`,
        // significa que hay una operación anterior bloqueada (conflicto/validación/backoff):
        // no se puede adelantar `op` porque rompería el orden causal de la entidad.
        if (
          unconfirmedEntityOps.length > 0 &&
          unconfirmedEntityOps[0].idOperacion !== op.idOperacion
        ) {
          blockedByEarlierUnconfirmed = true;
          summary.skippedBlockedByOrderCount++;
          continue;
        }

        if (inFlightOperationIds.has(op.idOperacion)) {
          blockedByEarlierUnconfirmed = true;
          continue;
        }

        // Si durante el ciclo se perdió la conexión, detener el envío sin perder operaciones
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          summary.status = 'offline';
          return summary;
        }

        const outcome = await this.processSingleOperation(op);

        if (outcome === 'ACCEPTED') {
          summary.confirmedCount++;
          const idx = unconfirmedEntityOps.findIndex((item) => item.idOperacion === op.idOperacion);
          if (idx !== -1) unconfirmedEntityOps.splice(idx, 1);
        } else if (outcome === 'ALREADY_PROCESSED') {
          summary.confirmedCount++;
          summary.alreadyProcessedCount++;
          const idx = unconfirmedEntityOps.findIndex((item) => item.idOperacion === op.idOperacion);
          if (idx !== -1) unconfirmedEntityOps.splice(idx, 1);
        } else if (outcome === 'CONFLICT') {
          summary.conflictCount++;
          blockedByEarlierUnconfirmed = true;
        } else if (outcome === 'VALIDATION_ERROR') {
          summary.validationErrorCount++;
          blockedByEarlierUnconfirmed = true;
        } else {
          summary.transientErrorCount++;
          blockedByEarlierUnconfirmed = true;
        }
      }
    }

    return summary;
  },

  async processSingleOperation(
    op: LocalOutboxQueue
  ): Promise<'ACCEPTED' | 'ALREADY_PROCESSED' | 'CONFLICT' | 'VALIDATION_ERROR' | 'TRANSIENT_ERROR'> {
    inFlightOperationIds.add(op.idOperacion);

    try {
      const acquired = await OutboxRepository.markInProgress(op.idOperacion);
      if (!acquired) {
        return 'TRANSIENT_ERROR';
      }

      // Leer el registro local más reciente para obtener remoteId o serverVersion actualizados
      // por operaciones previas de la misma entidad confirmadas en este mismo ciclo
      const entityTable = getEntityTable(op.entidad);
      const latestEntity = entityTable ? await entityTable.get(op.idEntidad) : undefined;

      const effectiveVersionBase =
        op.versionBase !== null && op.versionBase !== undefined
          ? op.versionBase
          : (latestEntity?.serverVersion ?? null);

      const dto: SyncOperationRequestDto = SyncHttpClient.serializeOperationDto(
        {
          ...op,
          versionBase: effectiveVersionBase
        },
        latestEntity?.remoteId ?? null
      );

      const result = await SyncHttpClient.sendOperation(dto);

      switch (result.resultado) {
        case 'ACCEPTED':
        case 'ALREADY_PROCESSED': {
          await this.applyConfirmedOutcome(op, result);
          return result.resultado;
        }
        case 'CONFLICT': {
          await this.applyConflictOutcome(op, result);
          return 'CONFLICT';
        }
        case 'VALIDATION_ERROR': {
          await this.applyValidationErrorOutcome(op, result);
          return 'VALIDATION_ERROR';
        }
        case 'TRANSIENT_ERROR':
        default: {
          await this.applyTransientErrorOutcome(op, result);
          return 'TRANSIENT_ERROR';
        }
      }
    } catch (err) {
      await this.applyTransientErrorOutcome(op, {
        idOperacion: op.idOperacion,
        entidad: op.entidad,
        idEntidad: op.idEntidad,
        resultado: 'TRANSIENT_ERROR',
        mensaje:
          err instanceof Error
            ? err.message
            : 'Error inesperado durante el envío de la operación.'
      });
      return 'TRANSIENT_ERROR';
    } finally {
      inFlightOperationIds.delete(op.idOperacion);
    }
  },

  /**
   * Marca la operación como 'confirmado' en db.outbox y actualiza el registro local
   * existente (por su UUID) con remoteId y serverVersion sin duplicar registros.
   */
  async applyConfirmedOutcome(
    op: LocalOutboxQueue,
    result: SyncOperationResultDto
  ): Promise<void> {
    const entityTable = getEntityTable(op.entidad);
    const tablesToLock = entityTable ? [db.outbox, entityTable] : [db.outbox];

    await db.transaction('rw', tablesToLock, async () => {
      await db.outbox.update(op.idOperacion, {
        estado: 'confirmado',
        ultimoError: null,
        proximoIntento: null
      });

      if (!entityTable) return;

      const localRecord = await entityTable.get(op.idEntidad);
      if (!localRecord) return;

      // Verificar si quedan operaciones posteriores aún sin confirmar para esta misma entidad
      const remainingOps = await db.outbox
        .where('idEntidad')
        .equals(op.idEntidad)
        .filter((item) => item.entidad === op.entidad && item.estado !== 'confirmado')
        .count();

      const updates: Partial<BaseLocalEntity> = {
        syncStatus: remainingOps === 0 ? 'synced' : 'pending'
      };

      if (result.remoteId !== null && result.remoteId !== undefined) {
        updates.remoteId = result.remoteId;
      }

      if (result.versionServidor !== null && result.versionServidor !== undefined) {
        updates.serverVersion = result.versionServidor;
      }

      await entityTable.update(op.idEntidad, updates as unknown as UpdateSpec<BaseLocalEntity>);
    });
  },

  /**
   * Conserva la operación en estado 'conflicto', crea un conflicto persistente
   * en db.syncConflicts y marca la entidad local como 'conflict' sin borrar cambios.
   */
  async applyConflictOutcome(
    op: LocalOutboxQueue,
    result: SyncOperationResultDto
  ): Promise<void> {
    const entityTable = getEntityTable(op.entidad);
    const tablesToLock = entityTable
      ? [db.outbox, db.syncConflicts, entityTable]
      : [db.outbox, db.syncConflicts];

    await db.transaction('rw', tablesToLock, async () => {
      const now = new Date().toISOString();
      const message =
        result.mensaje?.trim() ||
        'Conflicto de versión: el registro fue modificado en el servidor.';

      await db.outbox.update(op.idOperacion, {
        estado: 'conflicto',
        intentos: op.intentos + 1,
        ultimoError: message,
        proximoIntento: null
      });

      const localRecord = entityTable ? await entityTable.get(op.idEntidad) : undefined;
      const existingConflict = await db.syncConflicts
        .where('idOperacion')
        .equals(op.idOperacion)
        .first();

      const conflictEntry: LocalSyncConflict = {
        idConflicto: existingConflict?.idConflicto ?? crypto.randomUUID(),
        idOperacion: op.idOperacion,
        entidad: op.entidad,
        idEntidad: op.idEntidad,
        remoteId: result.remoteId ?? localRecord?.remoteId ?? null,
        operacionLocal: {
          ...op,
          estado: 'conflicto',
          intentos: op.intentos + 1,
          ultimoError: message,
          proximoIntento: null
        },
        datosLocales: localRecord
          ? ({ ...localRecord } as unknown as Record<string, unknown>)
          : isPlainRecord(op.payload)
            ? op.payload
            : {},
        versionBase: op.versionBase,
        estadoServidor: result.estadoServidor ?? null,
        versionServidor: result.versionServidor ?? null,
        tipoConflicto: op.tipoOperacion === 'DELETE' ? 'DELETED_ON_SERVER' : 'VERSION_MISMATCH',
        estadoResolucion: 'pendiente',
        fechaDeteccion: existingConflict?.fechaDeteccion ?? now,
        fechaResolucion: null,
        notasResolucion: null
      };

      await db.syncConflicts.put(conflictEntry);

      if (entityTable && localRecord) {
        const entityUpdates: Partial<BaseLocalEntity> = {
          syncStatus: 'conflict'
        };
        if (result.versionServidor !== null && result.versionServidor !== undefined) {
          entityUpdates.serverVersion = result.versionServidor;
        }
        await entityTable.update(
          op.idEntidad,
          entityUpdates as unknown as UpdateSpec<BaseLocalEntity>
        );
      }
    });
  },

  /**
   * Registra el error de validación en db.outbox sin crear un conflicto de sincronización
   * y sin programar reintentos automáticos infinitos (proximoIntento = null).
   */
  async applyValidationErrorOutcome(
    op: LocalOutboxQueue,
    result: SyncOperationResultDto
  ): Promise<void> {
    const entityTable = getEntityTable(op.entidad);
    const tablesToLock = entityTable ? [db.outbox, entityTable] : [db.outbox];
    const formattedMessage = formatValidationErrorMessage(result);

    await db.transaction('rw', tablesToLock, async () => {
      await db.outbox.update(op.idOperacion, {
        estado: 'fallido',
        intentos: op.intentos + 1,
        ultimoError: formattedMessage,
        proximoIntento: null
      });

      if (entityTable) {
        const localRecord = await entityTable.get(op.idEntidad);
        if (localRecord) {
          const entityUpdates: Partial<BaseLocalEntity> = {
            syncStatus: 'error'
          };
          await entityTable.update(
            op.idEntidad,
            entityUpdates as unknown as UpdateSpec<BaseLocalEntity>
          );
        }
      }
    });
  },

  /**
   * Conserva la operación intacta con su mismo idOperacion y programa el siguiente
   * reintento mediante espera progresiva hasta alcanzar MAX_PUSH_RETRY_ATTEMPTS.
   */
  async applyTransientErrorOutcome(
    op: LocalOutboxQueue,
    result: SyncOperationResultDto
  ): Promise<void> {
    const nextAttempts = op.intentos + 1;
    const rawMessage =
      result.mensaje?.trim() || 'Error temporal de red o disponibilidad del servidor.';

    if (nextAttempts >= MAX_PUSH_RETRY_ATTEMPTS) {
      await db.outbox.update(op.idOperacion, {
        estado: 'fallido',
        intentos: nextAttempts,
        ultimoError: `Límite de ${MAX_PUSH_RETRY_ATTEMPTS} reintentos alcanzado. Último error: ${rawMessage}`,
        proximoIntento: null
      });
      return;
    }

    const backoffMs =
      result.retryAfterMs && result.retryAfterMs > 0
        ? result.retryAfterMs
        : this.calculateBackoffMs(op.intentos);

    const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();

    await db.outbox.update(op.idOperacion, {
      estado: 'fallido',
      intentos: nextAttempts,
      ultimoError: rawMessage,
      proximoIntento: nextRetryIso
    });
  }
};
