import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { PushSyncEngine, type PushCycleSummary } from './push-sync.engine';
import type { LocalOutboxQueue } from '../../lib/database/schema';

export const OutboxService = {
  async getPendingOperations(): Promise<LocalOutboxQueue[]> {
    return await OutboxRepository.getAllNonConfirmed();
  },

  async pushAll(): Promise<PushCycleSummary> {
    return await PushSyncEngine.pushPendingOperations();
  },

  async retryOperation(idOperacion: string): Promise<PushCycleSummary> {
    await OutboxRepository.scheduleManualRetry(idOperacion);
    return await PushSyncEngine.pushPendingOperations();
  }
};
