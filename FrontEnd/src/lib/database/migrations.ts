import type Dexie from 'dexie';

/**
 * Aplica migraciones y configura actualizaciones evolutivas de la base de datos local.
 */
export function configureMigrations(db: Dexie): void {
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
    outbox: 'id, entityType, entityId, action, createdAt, attempts',
    syncMetadata: 'entityName'
  });
}
