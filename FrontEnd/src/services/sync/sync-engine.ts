import { PushSyncEngine } from './push-sync.engine';
import { SyncPullEngine, type PullEntitySummary } from './sync-pull.engine';
import { BoviScaleAnalysisService } from '../boviscale-analysis.service';

export type PushEngineResult = Awaited<
  ReturnType<typeof PushSyncEngine.pushPendingOperations>
>;

export interface FullSyncCycleResult {
  push: PushEngineResult;
  pull: PullEntitySummary[];
  pushCompleted: boolean;
  pullCompleted: boolean;
  allTasksCompleted: boolean;
  finishedAt: string;
}

let activeEngineCycle: Promise<FullSyncCycleResult | null> | null = null;

export const SyncEngine = {
  get isSyncing(): boolean {
    return activeEngineCycle !== null;
  },

  async sync(): Promise<FullSyncCycleResult | null> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }

    // Evita dos ejecuciones simultáneas devolviendo la promesa activa
    if (activeEngineCycle) {
      return await activeEngineCycle;
    }

    activeEngineCycle = (async () => {
      try {
        const push = await this.pushChanges();
        const pull = await this.pullChanges();
        await BoviScaleAnalysisService.processPendingQueue();

        const pushCompleted =
          (push.status === 'completed' || push.status === 'nothing_to_push') &&
          push.transientErrorCount === 0 &&
          push.validationErrorCount === 0 &&
          push.conflictCount === 0;

        const pullCompleted =
          pull.length > 0 && pull.every((item) => item.status === 'completed');

        return {
          push,
          pull,
          pushCompleted,
          pullCompleted,
          allTasksCompleted: pushCompleted && pullCompleted,
          finishedAt: new Date().toISOString()
        };
      } catch (err) {
        console.error('Error en el ciclo de sincronización:', err);
        return null;
      } finally {
        activeEngineCycle = null;
      }
    })();

    return await activeEngineCycle;
  },

  async pushChanges(): Promise<PushEngineResult> {
    return await PushSyncEngine.pushPendingOperations();
  },

  async pullChanges(): Promise<PullEntitySummary[]> {
    return await SyncPullEngine.pullAllEntities();
  }
};
