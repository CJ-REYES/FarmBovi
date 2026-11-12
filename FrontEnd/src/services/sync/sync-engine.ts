import { OutboxService } from './outbox.service';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
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

    console.debug(
      `Outbox con ${operations.length} operación(es) lista(s) para envío cuando el endpoint esté disponible.`
    );
  },

  async pullChanges(): Promise<void> {
    const checkpoint = await CheckpointRepository.getByEntity('cattle');
    console.debug('Checkpoint opaco actual (cattle):', checkpoint?.cursorOpaco ?? null);
  }
};
