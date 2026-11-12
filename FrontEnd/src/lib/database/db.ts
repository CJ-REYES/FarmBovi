import Dexie, { type Table } from 'dexie';
import type {
  LocalCattle,
  LocalWeighing,
  LocalHealthRecord,
  LocalFeedingRecord,
  LocalReproductionRecord,
  LocalLot,
  LocalMovement,
  LocalGenealogy,
  LocalAlert,
  LocalMedia,
  LocalWeighingAnalysisJob,
  LocalOutboxQueue,
  LocalSyncConflict,
  LocalSyncCheckpoint,
  LocalSyncMetadata,
  LocalServerChange
} from './schema';
import { configureMigrations } from './migrations';

export class FarmBoviLocalDB extends Dexie {
  cattle!: Table<LocalCattle, string>;
  weighings!: Table<LocalWeighing, string>;
  healthRecords!: Table<LocalHealthRecord, string>;
  feedingRecords!: Table<LocalFeedingRecord, string>;
  reproductionRecords!: Table<LocalReproductionRecord, string>;
  lots!: Table<LocalLot, string>;
  movements!: Table<LocalMovement, string>;
  genealogy!: Table<LocalGenealogy, string>;
  alerts!: Table<LocalAlert, string>;
  media!: Table<LocalMedia, string>;
  weighingAnalysisJobs!: Table<LocalWeighingAnalysisJob, string>;
  outbox!: Table<LocalOutboxQueue, string>;
  syncConflicts!: Table<LocalSyncConflict, string>;
  syncCheckpoints!: Table<LocalSyncCheckpoint, string>;
  serverChanges!: Table<LocalServerChange, number>;
  syncMetadata!: Table<LocalSyncMetadata, string>;

  constructor() {
    super('FarmBoviLocalDB');
    configureMigrations(this);
  }
}

export const db = new FarmBoviLocalDB();

export const StorageManager = {
  async getStorageEstimate(): Promise<{ usage?: number; quota?: number; percentage?: number }> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage;
        const quota = estimate.quota;
        const percentage = usage && quota ? Math.round((usage / quota) * 100) : undefined;
        return { usage, quota, percentage };
      } catch (error) {
        console.warn('Error al calcular la estimación de almacenamiento:', error);
      }
    }
    return {};
  },

  async requestPersistentStorage(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        return await navigator.storage.persist();
      } catch (error) {
        console.warn('No se pudo conceder almacenamiento persistente:', error);
      }
    }
    return false;
  },

  async checkIsPersisted(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persisted) {
      try {
        return await navigator.storage.persisted();
      } catch (error) {
        console.warn('Error al verificar el estado de persistencia:', error);
      }
    }
    return false;
  }
};
