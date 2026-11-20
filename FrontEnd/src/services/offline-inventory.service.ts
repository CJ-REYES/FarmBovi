import { db, StorageManager } from '../lib/database/db';

export interface OfflineEntityCounts {
  ranches: number;
  cattle: number;
  lots: number;
  movements: number;
  feedingRecords: number;
  weighings: number;
  healthRecords: number;
  treatments: number;
  reproductionRecords: number;
  genealogy: number;
  alerts: number;
}

export interface OfflineInventorySnapshot {
  counts: OfflineEntityCounts;
  totalLocalRecords: number;
  hasLocalData: boolean;
  pendingOperationsCount: number;
  isStoragePersisted: boolean;
  storageUsageBytes?: number;
  storageQuotaBytes?: number;
  storageUsagePercentage?: number;
  storageWarning: boolean;
  checkedAt: string;
}

export const OfflineInventoryService = {
  async getSnapshot(): Promise<OfflineInventorySnapshot> {
    const [
      ranches,
      cattle,
      lots,
      movements,
      feedingRecords,
      weighings,
      healthRecords,
      treatments,
      reproductionRecords,
      genealogy,
      alerts,
      pendingOperationsCount,
      isStoragePersisted,
      estimate
    ] = await Promise.all([
      db.ranches.filter((r) => !r.deletedAt).count(),
      db.cattle.filter((r) => !r.deletedAt).count(),
      db.lots.filter((r) => !r.deletedAt).count(),
      db.movements.filter((r) => !r.deletedAt).count(),
      db.feedingRecords.filter((r) => !r.deletedAt).count(),
      db.weighings.filter((r) => !r.deletedAt).count(),
      db.healthRecords.filter((r) => !r.deletedAt).count(),
      db.treatments.filter((r) => !r.deletedAt).count(),
      db.reproductionRecords.filter((r) => !r.deletedAt).count(),
      db.genealogy.filter((r) => !r.deletedAt).count(),
      db.alerts.filter((r) => !r.deletedAt).count(),
      db.outbox
        .filter((op) => op.estado === 'pendiente' || op.estado === 'en_proceso')
        .count(),
      StorageManager.checkIsPersisted(),
      StorageManager.getStorageEstimate()
    ]);

    const counts: OfflineEntityCounts = {
      ranches,
      cattle,
      lots,
      movements,
      feedingRecords,
      weighings,
      healthRecords,
      treatments,
      reproductionRecords,
      genealogy,
      alerts
    };

    const totalLocalRecords =
      ranches +
      cattle +
      lots +
      movements +
      feedingRecords +
      weighings +
      healthRecords +
      treatments +
      reproductionRecords +
      genealogy +
      alerts;

    const percentage = estimate.percentage;

    return {
      counts,
      totalLocalRecords,
      hasLocalData: totalLocalRecords > 0,
      pendingOperationsCount,
      isStoragePersisted,
      storageUsageBytes: estimate.usage,
      storageQuotaBytes: estimate.quota,
      storageUsagePercentage: percentage,
      storageWarning: typeof percentage === 'number' && percentage >= 85,
      checkedAt: new Date().toISOString()
    };
  }
};
