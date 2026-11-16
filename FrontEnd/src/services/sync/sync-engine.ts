import { OutboxService } from './outbox.service';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { SyncHttpClient } from './sync-http.client';
import { BoviScaleAnalysisService } from '../boviscale-analysis.service';

export const SyncEngine = {
  isSyncing: false,

  async sync(): Promise<void> {
    if (this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) return;

    try {
      this.isSyncing = true;
      await this.pushChanges();
      await this.pullChanges();
      await BoviScaleAnalysisService.processPendingQueue();
    } catch (err) {
      console.error('Error en el ciclo de sincronización:', err);
    } finally {
      this.isSyncing = false;
    }
  },

  async pushChanges(): Promise<void> {
    const operations = await OutboxService.getPendingOperations();
    if (operations.length === 0) return;

    const availability = SyncHttpClient.getEndpointAvailability();
    if (!availability.pushDisponible) {
      console.debug(
        `Outbox con ${operations.length} operación(es) pendiente(s); endpoint de push aún no habilitado en el backend.`
      );
    }
  },

  async pullChanges(): Promise<void> {
    const checkpoint = await CheckpointRepository.getByEntity('cattle');
    const availability = SyncHttpClient.getEndpointAvailability();
    if (!availability.pullDisponible) {
      console.debug(
        'Endpoint de pull incremental aún no habilitado en el backend. Cursor actual:',
        checkpoint?.cursorOpaco ?? null
      );
    }
  }
};
