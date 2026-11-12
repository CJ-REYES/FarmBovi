import type Dexie from 'dexie';
import type {
  LocalCattle,
  LocalMedia,
  LocalOutboxQueue,
  LocalSyncCheckpoint,
  LocalSyncMetadata,
  OutboxOperationState,
  OutboxOperationType,
  SyncEntityName
} from './schema';

/**
 * Genera un entero negativo estable de 32 bits a partir de un UUID v4
 * para evitar mapas volátiles en memoria y colisiones con IDs positivos del servidor.
 */
export function computeStableNegativeId(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const char = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const positive = Math.abs(hash) || 1;
  return -positive;
}

function normalizeLegacyOutboxState(rawState: unknown): OutboxOperationState {
  switch (rawState) {
    case 'pendiente':
    case 'pending':
      return 'pendiente';
    case 'en_proceso':
    case 'syncing':
      return 'en_proceso';
    case 'confirmado':
    case 'confirmed':
    case 'synced':
      return 'confirmado';
    case 'conflicto':
    case 'conflict':
      return 'conflicto';
    case 'fallido':
    case 'failed':
      return 'fallido';
    default:
      return 'pendiente';
  }
}

function normalizeLegacyOperationType(rawOp: unknown): OutboxOperationType {
  if (rawOp === 'CREATE' || rawOp === 'UPDATE' || rawOp === 'DELETE') {
    return rawOp;
  }
  return 'UPDATE';
}

export function configureMigrations(db: Dexie): void {
  // Versión 1: Esquema base histórico (conservado para trazabilidad de actualización)
  db.version(1).stores({
    cattle: 'id, remoteId, ranchId, areteSiniiga, loteId, syncStatus, updatedAt, createdAt',
    weighings: 'id, remoteId, ranchId, cattleId, fecha, syncStatus, updatedAt',
    healthRecords: 'id, remoteId, ranchId, cattleId, tipo, fecha, syncStatus, updatedAt',
    feedingRecords: 'id, remoteId, ranchId, lotId, fecha, syncStatus, updatedAt',
    reproductionRecords: 'id, remoteId, ranchId, cattleId, evento, fecha, syncStatus, updatedAt',
    lots: 'id, remoteId, ranchId, nombre, syncStatus, updatedAt',
    movements: 'id, remoteId, ranchId, cattleId, fecha, syncStatus, updatedAt',
    genealogy: 'id, remoteId, ranchId, cattleId, padreId, madreId, syncStatus, updatedAt',
    alerts: 'id, remoteId, ranchId, tipo, prioridad, leida, fecha, syncStatus',
    media: 'id, remoteId, ranchId, cattleId, tipo, syncStatus, updatedAt',
    outbox: 'id, entity, entityId, operation, status, createdAt',
    syncMetadata: 'entityName'
  });

  // Versión 2: Normalización Offline-First (Outbox idempotente, Conflictos, Checkpoints opacos, Media y Trabajos BoviScale)
  db.version(2)
    .stores({
      cattle: 'id, localNumericId, remoteId, ranchId, areteSiniiga, loteId, syncStatus, updatedAt, createdAt',
      weighings: 'id, localNumericId, remoteId, ranchId, cattleId, fecha, syncStatus, updatedAt',
      healthRecords: 'id, localNumericId, remoteId, ranchId, cattleId, tipo, fecha, syncStatus, updatedAt',
      feedingRecords: 'id, localNumericId, remoteId, ranchId, lotId, fecha, syncStatus, updatedAt',
      reproductionRecords: 'id, localNumericId, remoteId, ranchId, cattleId, evento, fecha, syncStatus, updatedAt',
      lots: 'id, localNumericId, remoteId, ranchId, nombre, syncStatus, updatedAt',
      movements: 'id, localNumericId, remoteId, ranchId, cattleId, fecha, syncStatus, updatedAt',
      genealogy: 'id, localNumericId, remoteId, ranchId, cattleId, padreId, madreId, syncStatus, updatedAt',
      alerts: 'id, localNumericId, remoteId, ranchId, tipo, prioridad, leida, fecha, syncStatus',
      media: 'id, remoteId, ranchId, cattleId, idEntidadRelacionada, tipo, estadoArchivo, idOperacionSubida, fechaCaptura, syncStatus, updatedAt',
      weighingAnalysisJobs: 'idTrabajo, idMedia, idBovino, ranchId, idOperacion, estado, fechaCreacion, actualizadoEn',
      outbox: 'id, &idOperacion, entidad, idEntidad, tipoOperacion, estado, fechaCreacion, proximoIntento',
      syncConflicts: 'idConflicto, idOperacion, entidad, idEntidad, tipoConflicto, estadoResolucion, fechaDeteccion',
      syncCheckpoints: 'entidad, cursorOpaco, actualizadoEn',
      syncMetadata: 'entityName'
    })
    .upgrade(async (tx) => {
      const now = new Date().toISOString();

      // 1. Asignar localNumericId persistente a bovinos existentes sin borrar registros
      const cattleTable = tx.table<LocalCattle, string>('cattle');
      await cattleTable.toCollection().modify((record) => {
        if (typeof record.localNumericId !== 'number') {
          record.localNumericId = computeStableNegativeId(record.id);
        }
        if (record.serverVersion === undefined) {
          record.serverVersion = null;
        }
      });

      // 2. Migrar operaciones existentes en outbox preservando su UUID y datos
      const outboxTable = tx.table<Record<string, unknown>, string>('outbox');
      await outboxTable.toCollection().modify((raw) => {
        const legacyId = typeof raw.id === 'string' && raw.id.length > 0
          ? raw.id
          : crypto.randomUUID();
        const permanentUuid = typeof raw.idOperacion === 'string' && raw.idOperacion.length > 0
          ? raw.idOperacion
          : legacyId;

        const normalized: LocalOutboxQueue = {
          id: permanentUuid,
          idOperacion: permanentUuid,
          entidad: ((raw.entidad || raw.entity || 'cattle') as SyncEntityName),
          idEntidad: String(raw.idEntidad || raw.entityId || ''),
          tipoOperacion: normalizeLegacyOperationType(raw.tipoOperacion || raw.operation),
          versionBase: (raw.versionBase as number | string | null | undefined) ?? null,
          payload: raw.payload ?? null,
          estado: normalizeLegacyOutboxState(raw.estado || raw.status),
          fechaCreacion: String(raw.fechaCreacion || raw.createdAt || now),
          intentos: typeof raw.intentos === 'number'
            ? raw.intentos
            : (typeof raw.attempts === 'number' ? raw.attempts : 0),
          ultimoError: (raw.ultimoError ?? raw.lastError ?? null) as string | null,
          proximoIntento: (raw.proximoIntento ?? null) as string | null
        };

        Object.assign(raw, normalized);
      });

      // 3. Normalizar metadatos de archivos en media sin perder Blobs existentes
      const mediaTable = tx.table<Record<string, unknown>, string>('media');
      await mediaTable.toCollection().modify((raw) => {
        const blob = raw.blobData instanceof Blob ? raw.blobData : undefined;
        const created = String(raw.createdAt || now);

        const updates: Partial<LocalMedia> = {
          entidadRelacionada: (raw.entidadRelacionada as LocalMedia['entidadRelacionada']) || 'cattle',
          idEntidadRelacionada: (raw.idEntidadRelacionada as string | undefined) || (raw.cattleId as string | undefined),
          nombreArchivo: String(raw.nombreArchivo || `captura-${String(raw.id || crypto.randomUUID())}.jpg`),
          mimeType: String(raw.mimeType || blob?.type || 'application/octet-stream'),
          tamanoBytes: typeof raw.tamanoBytes === 'number' ? raw.tamanoBytes : (blob?.size ?? 0),
          estadoArchivo: (raw.estadoArchivo as LocalMedia['estadoArchivo']) || (raw.syncStatus === 'synced' ? 'subido' : 'pendiente_subida'),
          intentosSubida: typeof raw.intentosSubida === 'number' ? raw.intentosSubida : 0,
          ultimoErrorSubida: (raw.ultimoErrorSubida as string | null | undefined) ?? null,
          fechaCaptura: String(raw.fechaCaptura || created)
        };

        Object.assign(raw, updates);
      });

      // 4. Inicializar checkpoints sin avanzar cursores opacos artificialmente
      const metaTable = tx.table<LocalSyncMetadata, string>('syncMetadata');
      const checkpointTable = tx.table<LocalSyncCheckpoint, SyncEntityName>('syncCheckpoints');
      const existingMetas = await metaTable.toArray();

      for (const meta of existingMetas) {
        const entity = meta.entityName as SyncEntityName;
        const alreadyExists = await checkpointTable.get(entity);
        if (!alreadyExists) {
          await checkpointTable.put({
            entidad: entity,
            cursorOpaco: null, // No se inventa ni avanza cursor sin respuesta real del servidor
            ultimaFechaServidor: meta.lastSyncedAt ?? null,
            actualizadoEn: now
          });
        }
      }
    });
}
