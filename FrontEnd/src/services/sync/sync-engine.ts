import { db } from '../../lib/database/db';
// Importación desactivada temporalmente hasta que el backend integre idempotencia
// import { cattleApi } from '../../lib/api';
import { OutboxService } from './outbox.service';
import { ConflictResolver } from './conflict-resolver';
import type { LocalOutboxQueue, LocalCattle } from '../../lib/database/schema';

// Definición estricta para evitar aserciones "any"
interface ConflictApiError {
  status?: number;
  data?: {
    serverState?: Partial<LocalCattle>;
  };
}

export const SyncEngine = {
  isSyncing: false,

  async sync(): Promise<void> {
    if (this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) return;

    try {
      this.isSyncing = true;
      await this.pushChanges();
      await this.pullChanges();
    } catch (err) {
      console.error('Error crítico en el ciclo de sincronización:', err);
    } finally {
      this.isSyncing = false;
    }
  },

  async pushChanges(): Promise<void> {
    const operations = await OutboxService.getPendingOperations();

    for (const op of operations) {
      if (op.attempts > 10) continue;

      try {
        await OutboxService.markAsSyncing(op.id);

        await this.executeOperation(op);

        await OutboxService.markAsSynced(op.id);
        await db.cattle.update(op.entityId, { syncStatus: 'synced' });

      } catch (err: unknown) {
        // Validación estricta sin usar "any"
        const conflictErr = err as ConflictApiError;
        if (conflictErr && typeof conflictErr === 'object' && conflictErr.status === 409) {
          const localRecord = await db.cattle.get(op.entityId);
          const serverState = conflictErr.data?.serverState;

          if (localRecord && serverState) {
            await ConflictResolver.registerConflict(op.entityId, localRecord, serverState);
            await OutboxService.markAsSynced(op.id);
          }
        } else {
          const errorMsg = err instanceof Error ? err.message : 'Network/Server Error';
          await OutboxService.markAsFailed(op.id, errorMsg);

          await new Promise(res => setTimeout(res, OutboxService.calculateBackoff(op.attempts)));
        }
      }
    }
  },

  async executeOperation(op: LocalOutboxQueue): Promise<void> {
    // const payload = op.payload as CattleInput;

    switch (op.operation) {
      case 'CREATE': { // Se usan corchetes para aislar el alcance de las variables (lexical declaration)
        // REQUIERE: cattleApi.createWithIdempotency(payload, op.id);
        console.debug('Simulando CREATE saliente idempotente', op.id);
        break;
      }
      case 'UPDATE': {
        const record = await db.cattle.get(op.entityId);
        if (record?.remoteId) {
          // REQUIERE: cattleApi.updateWithVersion(Number(record.remoteId), payload, record.serverVersion);
          console.debug('Simulando UPDATE saliente concurrente', record.remoteId);
        }
        break;
      }
      case 'DELETE': {
        const toDelete = await db.cattle.get(op.entityId);
        if (toDelete?.remoteId) {
           // REQUIERE: cattleApi.removeLogically(Number(toDelete.remoteId));
           console.debug('Simulando DELETE saliente lógico', toDelete.remoteId);
        }
        break;
      }
    }
  },

  async pullChanges(): Promise<void> {
    const meta = await db.syncMetadata.get('cattle');

    // Preparado para el cursor vectorial:
    // const lastSync = meta?.lastSyncedAt || new Date(0).toISOString();
    // const deltas = await cattleApi.getSyncDelta(lastSync);
    console.debug('Cursor local de sincronización:', meta?.lastSyncedAt);

    await db.syncMetadata.put({
      entityName: 'cattle',
      lastSyncedAt: new Date().toISOString()
    });
  }
};
