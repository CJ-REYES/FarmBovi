import { StorageManager } from './db';

export const StorageMonitor = {
  async initPersistenceAndCheck(): Promise<{ persisted: boolean; percentage?: number; warning: boolean }> {
    // Solicitar almacenamiento persistente
    const isAlreadyPersisted = await StorageManager.checkIsPersisted();
    if (!isAlreadyPersisted) {
      await StorageManager.requestPersistentStorage();
    }

    const estimate = await StorageManager.getStorageEstimate();
    const percentage = estimate.percentage || 0;

    // Advertencia si el almacenamiento supera el 85% de ocupación
    const warning = percentage >= 85;

    return {
      persisted: await StorageManager.checkIsPersisted(),
      percentage,
      warning
    };
  }
};
