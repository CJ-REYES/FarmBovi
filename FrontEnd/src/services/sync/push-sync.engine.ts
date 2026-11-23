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
import { isValidGuid } from '../cattle.validation';
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
  ranches: 0,
  lots: 1,
  cattle: 2,
  genealogy: 3,
  movements: 4,
  weighings: 5,
  healthRecords: 6,
  treatments: 7,
  feedingRecords: 8,
  reproductionRecords: 9,
  alerts: 10,
  media: 11,
  weighingAnalysisJobs: 12
};

/**
 * Entidades habilitadas para Push en `POST /api/sync/operaciones`.
 * Si el Backend aún no habilita alguna (p. ej. `Pesaje`), `sync-http.client.ts`
 * clasifica el 400 "no está soportada" como error transitorio para conservarla en cola.
 */
const BACKEND_PUSH_SUPPORTED_ENTITIES = new Set<SyncEntityName>([
  'ranches',
  'lots',
  'cattle',
  'weighings',
  'healthRecords',
  'treatments',
  'feedingRecords',
  'movements',
  'alerts'
]);

const inFlightOperationIds = new Set<string>();
let activePushPromise: Promise<PushCycleSummary> | null = null;

function getEntityTable(entidad: SyncEntityName): Table<BaseLocalEntity, string> | null {
  switch (entidad) {
    case 'ranches':
      return db.ranches as unknown as Table<BaseLocalEntity, string>;
    case 'cattle':
      return db.cattle as unknown as Table<BaseLocalEntity, string>;
    case 'weighings':
      return db.weighings as unknown as Table<BaseLocalEntity, string>;
    case 'healthRecords':
      return db.healthRecords as unknown as Table<BaseLocalEntity, string>;
    case 'treatments':
      return db.treatments as unknown as Table<BaseLocalEntity, string>;
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

function readGuidField(record: Record<string, unknown> | undefined, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const val = record[key];
    if (typeof val === 'string' && isValidGuid(val.trim())) {
      return val.trim();
    }
  }
  return null;
}

/**
 * Resuelve el `idRancho` requerido por `POST /api/sync/operaciones` para cualquier entidad
 * (incluyendo entidades hijas como movimientos, tratamientos, salud o bajas lógicas).
 */
async function resolveOperationRanchId(
  op: LocalOutboxQueue,
  latestEntity: BaseLocalEntity | undefined
): Promise<string | null> {
  if (op.idRancho && isValidGuid(op.idRancho)) {
    return op.idRancho;
  }
  if (latestEntity?.ranchId && isValidGuid(latestEntity.ranchId)) {
    return latestEntity.ranchId;
  }

  const payloadRec = isPlainRecord(op.payload) ? op.payload : undefined;
  const entityRec = latestEntity as unknown as Record<string, unknown> | undefined;

  const direct =
    readGuidField(payloadRec, ['idRancho', 'ranchId']) ??
    readGuidField(entityRec, ['ranchId', 'idRancho']);
  if (direct) return direct;

  if (op.entidad === 'ranches' && isValidGuid(op.idEntidad)) {
    return op.idEntidad;
  }

  // Resolver desde animal padre si existe
  const cattleId =
    readGuidField(payloadRec, ['idAnimal', 'cattleId']) ??
    readGuidField(entityRec, ['cattleId', 'idAnimal']);
  if (cattleId) {
    const animal = await db.cattle.get(cattleId);
    if (animal?.ranchId && isValidGuid(animal.ranchId)) {
      return animal.ranchId;
    }
  }

  // Resolver desde lote padre si existe
  const lotId =
    readGuidField(payloadRec, ['idLote', 'lotId', 'loteId', 'idLoteDestino', 'idLoteOrigen']) ??
    readGuidField(entityRec, ['lotId', 'loteId', 'destinoLotId', 'origenLotId']);
  if (lotId) {
    const lot = await db.lots.get(lotId);
    if (lot?.ranchId && isValidGuid(lot.ranchId)) {
      return lot.ranchId;
    }
  }

  // Resolver desde evento sanitario padre (para tratamientos)
  const eventId =
    readGuidField(payloadRec, ['idEventoSanitario', 'eventoSanitarioId']) ??
    readGuidField(entityRec, ['eventoSanitarioId']);
  if (eventId) {
    const event = await db.healthRecords.get(eventId);
    if (event?.ranchId && isValidGuid(event.ranchId)) {
      return event.ranchId;
    }
    if (event?.cattleId) {
      const animal = await db.cattle.get(event.cattleId);
      if (animal?.ranchId && isValidGuid(animal.ranchId)) {
        return animal.ranchId;
      }
    }
  }

  // Último respaldo: primer rancho autorizado de la sesión activa o caché local
  if (typeof window !== 'undefined') {
    const rawCandidates = [
      window.sessionStorage?.getItem('farmbovi_session_user'),
      window.localStorage?.getItem('farmbovi_session_meta')
    ];
    for (const raw of rawCandidates) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as {
          idUsuario?: unknown;
          ranchos?: Array<{ idRancho?: string }>;
        };
        if (typeof parsed.idUsuario === 'string') {
          const firstAuthRanch = parsed.ranchos?.find(
            (r) => typeof r?.idRancho === 'string' && isValidGuid(r.idRancho)
          )?.idRancho;
          return firstAuthRanch ?? null;
        }
      } catch {
        // Ignorar si no es JSON válido
      }
    }
  }

  const fallbackRanch = await db.ranches.filter((r) => !r.deletedAt).first();
  if (fallbackRanch && isValidGuid(fallbackRanch.id)) {
    return fallbackRanch.id;
  }

  return null;
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

    const allDispatchableOps = await OutboxRepository.getDispatchableOperations();
    const dispatchableOps = allDispatchableOps.filter((op) =>
      BACKEND_PUSH_SUPPORTED_ENTITIES.has(op.entidad)
    );
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

      // Protección contra operaciones huérfanas sin versionBase (p. ej. DELETE/UPDATE heredados
      // cuyo CREATE nunca se confirmó en el servidor o fue descartado): evita HTTP 400 repetidos.
      if (op.tipoOperacion === 'DELETE' && effectiveVersionBase === null && !latestEntity?.remoteId) {
        await OutboxRepository.discardOperation(op.idOperacion, { allowInProgress: true });
        return 'ALREADY_PROCESSED';
      }

      if (op.tipoOperacion === 'UPDATE' && effectiveVersionBase === null && !latestEntity?.remoteId) {
        await this.applyValidationErrorOutcome(op, {
          idOperacion: op.idOperacion,
          entidad: op.entidad,
          idEntidad: op.idEntidad,
          resultado: 'VALIDATION_ERROR',
          mensaje:
            'Esta actualización pertenece a un registro local que nunca se creó en el servidor. Puedes descartarla desde el Centro de Sincronización.'
        });
        return 'VALIDATION_ERROR';
      }

      const resolvedRanchId = await resolveOperationRanchId(op, latestEntity);

      if (op.entidad !== 'ranches' && !resolvedRanchId) {
        await this.applyTransientErrorOutcome(op, {
          idOperacion: op.idOperacion,
          entidad: op.entidad,
          idEntidad: op.idEntidad,
          resultado: 'TRANSIENT_ERROR',
          mensaje:
            'Registra o sincroniza un rancho en la sección Ranchos para poder subir esta operación.'
        });
        return 'TRANSIENT_ERROR';
      }

      if (resolvedRanchId && op.idRancho !== resolvedRanchId) {
        await db.outbox.update(op.idOperacion, { idRancho: resolvedRanchId });
      }

      const effectiveOp: LocalOutboxQueue = {
        ...op,
        versionBase: effectiveVersionBase,
        idRancho: resolvedRanchId ?? op.idRancho ?? null
      };

      const dto: SyncOperationRequestDto = SyncHttpClient.serializeOperationDto(
        effectiveOp,
        latestEntity?.remoteId ?? null,
        resolvedRanchId
      );

      const result = await SyncHttpClient.sendOperation(dto);

      switch (result.resultado) {
        case 'ACCEPTED':
        case 'ALREADY_PROCESSED': {
          await this.applyConfirmedOutcome(effectiveOp, result);
          return result.resultado;
        }
        case 'CONFLICT': {
          await this.applyConflictOutcome(effectiveOp, result);
          return 'CONFLICT';
        }
        case 'VALIDATION_ERROR': {
          await this.applyValidationErrorOutcome(effectiveOp, result);
          return 'VALIDATION_ERROR';
        }
        case 'TRANSIENT_ERROR':
        default: {
          await this.applyTransientErrorOutcome(effectiveOp, result);
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
        tipoConflicto:
          result.tipoConflicto ??
          (op.tipoOperacion === 'DELETE' ? 'DELETED_ON_SERVER' : 'VERSION_MISMATCH'),
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
