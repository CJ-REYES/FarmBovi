import { OutboxService } from './outbox.service';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';

export const SyncEngine = {
  isSyncing: false,

  /**
   * Coordina el ciclo de sincronización sin simular confirmaciones ni avanzar cursores
   * mientras los endpoints distribuidos del backend no estén habilitados.
   */
  async sync(): Promise<void> {
    if (this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) return;

    try {
      this.isSyncing = true;
      await this.pushChanges();
      await this.pullChanges();
    } catch (err) {
      console.error('Error en el ciclo de sincronización:', err);
    } finally {
      this.isSyncing = false;
    }
  },

  async pushChanges(): Promise<void> {
    const operations = await OutboxService.getPendingOperations();
    if (operations.length === 0) return;

    // Los endpoints idempotentes de sincronización batch aún no están expuestos en .NET 10.
    // Las operaciones conservan su idOperacion UUID y su estado 'pendiente' sin simular éxito.
    console.debug(`Outbox con ${operations.length} operación(es) lista(s) para envío cuando el endpoint esté disponible.`);
  },

  async pullChanges(): Promise<void> {
    // Se lee el cursor opaco actual sin avanzarlo ni sobrescribirlo localmente
    const checkpoint = await CheckpointRepository.getByEntity('cattle');
    console.debug('Checkpoint opaco actual (cattle):', checkpoint?.cursorOpaco ?? null);
  }
};
