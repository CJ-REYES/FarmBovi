import { db } from '../db';
import type { LocalSyncMetadata, SyncEntityName } from '../schema';

export type SyncMetadataPhase = 'push' | 'pull' | 'media';

export const SyncMetadataRepository = {
  async getAll(): Promise<LocalSyncMetadata[]> {
    return await db.syncMetadata.toArray();
  },

  async getByEntity(entityName: SyncEntityName | string): Promise<LocalSyncMetadata | undefined> {
    return await db.syncMetadata.get(entityName);
  },

  async getEntitiesWithErrors(): Promise<LocalSyncMetadata[]> {
    const all = await db.syncMetadata.toArray();
    return all.filter((item) => Boolean(item.lastError && item.lastError.trim().length > 0));
  },

  async recordSuccess(
    entityName: SyncEntityName | string,
    phase: SyncMetadataPhase,
    ranchId?: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    await db.transaction('rw', [db.syncMetadata], async () => {
      const existing = await db.syncMetadata.get(entityName);
      const next: LocalSyncMetadata = {
        ...existing,
        entityName,
        lastSyncedAt: now,
        lastPushAt: phase === 'push' ? now : (existing?.lastPushAt ?? null),
        lastPullAt: phase === 'pull' ? now : (existing?.lastPullAt ?? null),
        lastRanchId: ranchId ?? existing?.lastRanchId ?? null,
        // Limpiar el error persistido solo si corresponde a la misma fase o ya se completó con éxito
        lastError:
          existing?.lastErrorPhase && existing.lastErrorPhase !== phase
            ? existing.lastError
            : null,
        lastErrorCode:
          existing?.lastErrorPhase && existing.lastErrorPhase !== phase
            ? existing.lastErrorCode
            : null,
        lastErrorPhase:
          existing?.lastErrorPhase && existing.lastErrorPhase !== phase
            ? existing.lastErrorPhase
            : null,
        lastErrorAt:
          existing?.lastErrorPhase && existing.lastErrorPhase !== phase
            ? existing.lastErrorAt
            : null,
        consecutiveFailures:
          existing?.lastErrorPhase && existing.lastErrorPhase !== phase
            ? (existing.consecutiveFailures ?? 0)
            : 0
      };
      await db.syncMetadata.put(next);
    });
  },

  async recordError(
    entityName: SyncEntityName | string,
    params: {
      phase: SyncMetadataPhase;
      message: string;
      code?: number | string | null;
      ranchId?: string | null;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    await db.transaction('rw', [db.syncMetadata], async () => {
      const existing = await db.syncMetadata.get(entityName);
      const next: LocalSyncMetadata = {
        ...existing,
        entityName,
        lastError: params.message.trim() || 'Error de sincronización.',
        lastErrorCode: params.code ?? null,
        lastErrorPhase: params.phase,
        lastErrorAt: now,
        lastRanchId: params.ranchId ?? existing?.lastRanchId ?? null,
        consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1
      };
      await db.syncMetadata.put(next);
    });
  },

  async clearError(entityName: SyncEntityName | string): Promise<void> {
    const existing = await db.syncMetadata.get(entityName);
    if (!existing) return;
    await db.syncMetadata.put({
      ...existing,
      lastError: null,
      lastErrorCode: null,
      lastErrorPhase: null,
      lastErrorAt: null,
      consecutiveFailures: 0
    });
  },

  async clearAll(): Promise<void> {
    await db.syncMetadata.clear();
  }
};
