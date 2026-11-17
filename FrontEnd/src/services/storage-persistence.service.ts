export type StorageHealthStatus =
  | 'ok'
  | 'warning'
  | 'critical'
  | 'quota_exceeded'
  | 'unavailable';

export interface StorageHealthSnapshot {
  isPersisted: boolean;
  persistenceSupported: boolean;
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
  status: StorageHealthStatus;
  message: string | null;
  checkedAt: string | null;
}

type StorageListener = () => void;

const WARNING_THRESHOLD_PERCENT = 80;
const CRITICAL_THRESHOLD_PERCENT = 95;

let snapshot: StorageHealthSnapshot = {
  isPersisted: false,
  persistenceSupported:
    typeof navigator !== 'undefined' &&
    Boolean(navigator.storage && typeof navigator.storage.persist === 'function'),
  usageBytes: 0,
  quotaBytes: 0,
  usagePercent: 0,
  status: 'ok',
  message: null,
  checkedAt: null
};

const listeners = new Set<StorageListener>();

function emit(next: StorageHealthSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error notificando estado de almacenamiento:', err);
    }
  }
}

export function formatStorageMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const StoragePersistenceService = {
  subscribe(listener: StorageListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): StorageHealthSnapshot {
    return snapshot;
  },

  async initializeAndRequestPersistence(): Promise<StorageHealthSnapshot> {
    if (typeof navigator === 'undefined' || !navigator.storage) {
      const unavailable: StorageHealthSnapshot = {
        ...snapshot,
        persistenceSupported: false,
        status: 'unavailable',
        message: 'La API de estimación de almacenamiento no está disponible en este navegador.',
        checkedAt: new Date().toISOString()
      };
      emit(unavailable);
      return unavailable;
    }

    let persisted = false;
    const supported = typeof navigator.storage.persist === 'function';

    try {
      if (typeof navigator.storage.persisted === 'function') {
        persisted = await navigator.storage.persisted();
      }
      if (!persisted && supported) {
        persisted = await navigator.storage.persist();
      }
    } catch {
      persisted = false;
    }

    return await this.checkQuota(persisted, supported);
  },

  async checkQuota(
    overridePersisted?: boolean,
    overrideSupported?: boolean
  ): Promise<StorageHealthSnapshot> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return snapshot;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usageBytes = estimate.usage ?? 0;
      const quotaBytes = estimate.quota ?? 0;
      const usagePercent =
        quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 1000) / 10) : 0;

      const isPersisted = overridePersisted ?? snapshot.isPersisted;
      const persistenceSupported = overrideSupported ?? snapshot.persistenceSupported;

      let status: StorageHealthStatus = 'ok';
      let message: string | null = null;

      if (usagePercent >= CRITICAL_THRESHOLD_PERCENT) {
        status = 'critical';
        message = `Almacenamiento local casi lleno (${usagePercent}% usado: ${formatStorageMb(
          usageBytes
        )} de ${formatStorageMb(
          quotaBytes
        )}). Sincroniza archivos pendientes o libera espacio en el dispositivo.`;
      } else if (usagePercent >= WARNING_THRESHOLD_PERCENT) {
        status = 'warning';
        message = `Espacio local elevado (${usagePercent}% usado: ${formatStorageMb(
          usageBytes
        )} de ${formatStorageMb(
          quotaBytes
        )}). Conviene sincronizar las fotografías pendientes.`;
      }

      const next: StorageHealthSnapshot = {
        isPersisted,
        persistenceSupported,
        usageBytes,
        quotaBytes,
        usagePercent,
        status,
        message,
        checkedAt: new Date().toISOString()
      };

      emit(next);
      return next;
    } catch {
      return snapshot;
    }
  },

  reportQuotaExceededError(contextDetail?: string): void {
    emit({
      ...snapshot,
      status: 'quota_exceeded',
      message:
        contextDetail ||
        'Espacio insuficiente en IndexedDB (QuotaExceededError). Libera espacio o sincroniza archivos antes de guardar nuevos registros.',
      checkedAt: new Date().toISOString()
    });
  }
};
