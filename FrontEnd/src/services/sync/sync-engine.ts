import { PushSyncEngine } from './push-sync.engine';
import { SyncPullEngine, type PullEntitySummary } from './sync-pull.engine';
import { BoviScaleAnalysisService } from '../boviscale-analysis.service';

export interface FullSyncCycleResult {
  push: Awaited<ReturnType<typeof PushSyncEngine.pushPendingOperations>>;
  pull: PullEntitySummary[];
}

export const SyncEngine = {
  isSyncing: false,

  async sync(): Promise<FullSyncCycleResult | null> {
    if (this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) {
      return null;
    }

    try {
      this.isSyncing = true;
      const push = await this.pushChanges();
      const pull = await this.pullChanges();
      await BoviScaleAnalysisService.processPendingQueue();
      return { push, pull };
    } catch (err) {
      console.error('Error en el ciclo de sincronización:', err);
      return null;
    } finally {
      this.isSyncing = false;
    }
  },

  async pushChanges() {
    return await PushSyncEngine.pushPendingOperations();
  },

  async pullChanges(): Promise<PullEntitySummary[]> {
    return await SyncPullEngine.pullAllEntities();
  }
};
