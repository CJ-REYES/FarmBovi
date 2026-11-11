import { db } from '../../lib/database/db';
import type { LocalOutboxQueue } from '../../lib/database/schema';

export const OutboxService = {
  async getPendingOperations(): Promise<LocalOutboxQueue[]> {
    return await db.outbox
      .where('status')
      .anyOf('pending', 'failed')
      .sortBy('createdAt');
  },

  async markAsSyncing(id: string): Promise<void> {
    await db.outbox.update(id, { status: 'syncing' });
  },

  async markAsSynced(id: string): Promise<void> {
    await db.outbox.delete(id); // Idempotencia exitosa: purgamos de la cola
  },

  async markAsFailed(id: string, errorMsg: string): Promise<void> {
    const record = await db.outbox.get(id);
    if (record) {
      await db.outbox.update(id, {
        status: 'failed',
        attempts: record.attempts + 1,
        lastError: errorMsg
      });
    }
  },

  calculateBackoff(attempts: number): number {
    const base = 2000; // 2 segundos
    const max = 60000; // 1 minuto máximo
    const exponential = Math.min(max, base * Math.pow(2, attempts));
    const jitter = Math.random() * 1000; // 0-1000ms de desvío estocástico
    return Math.floor(exponential + jitter);
  }
};
