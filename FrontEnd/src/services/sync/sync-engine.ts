import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { PushSyncEngine, type PushCycleSummary } from './push-sync.engine';
import { SyncHttpClient } from './sync-http.client';
import { BoviScaleAnalysisService } from '../boviscale-analysis.service';

export const SyncEngine = {
  isSyncing: false,

  async sync(): Promise<PushCycleSummary | null> {
    if (this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) {
      return null;
    }

    try {
      this.isSyncing = true;
      const pushSummary = await this.pushChanges();
      await this.pullChanges();
      await BoviScaleAnalysisService.processPendingQueue();
      return pushSummary;
    } catch (err) {
      console.error('Error en el ciclo de sincronización:', err);
      return null;
    } finally {
      this.isSyncing = false;
    }
  },

  async pushChanges(): Promise<PushCycleSummary> {
    return await PushSyncEngine.pushPendingOperations();
  },

  async pullChanges(): Promise<void> {
    const checkpoint = await CheckpointRepository.getByEntity('cattle');
    const availability = SyncHttpClient.getEndpointAvailability();
    if (!availability.pullDisponible) {
      console.debug(
        'Endpoint de pull incremental aún pendiente en el backend. Cursor actual:',
        checkpoint?.cursorOpaco ?? null
      );
    }
  }
};
