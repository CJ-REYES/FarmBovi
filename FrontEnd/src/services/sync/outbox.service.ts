import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import type { LocalOutboxQueue } from '../../lib/database/schema';

export const OutboxService = {
  async getPendingOperations(): Promise<LocalOutboxQueue[]> {
    return await OutboxRepository.getPendingAndRetryable();
  },

  async markAsSyncing(idOperacion: string): Promise<void> {
    await OutboxRepository.markInProgress(idOperacion);
  },

  async markAsConfirmed(idOperacion: string): Promise<void> {
    await OutboxRepository.markConfirmed(idOperacion);
  },

  async markAsFailed(idOperacion: string, errorMsg: string): Promise<void> {
    const record = await OutboxRepository.getByOperationId(idOperacion);
    const attempts = record ? record.intentos : 0;
    const backoffMs = this.calculateBackoff(attempts);
    const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();

    await OutboxRepository.markTemporaryFailure(idOperacion, errorMsg, nextRetryIso);
  },

  async markAsConflict(idOperacion: string, errorMsg: string): Promise<void> {
    await OutboxRepository.markConflict(idOperacion, errorMsg);
  },

  calculateBackoff(attempts: number): number {
    const base = 2000;
    const max = 60000;
    const exponential = Math.min(max, base * Math.pow(2, attempts));
    const jitter = Math.random() * 1000;
    return Math.floor(exponential + jitter);
  }
};
