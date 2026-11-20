export type ServiceWorkerLifecycleState =
  | 'unsupported'
  | 'unregistered'
  | 'registering'
  | 'registered'
  | 'update_available'
  | 'error';

export interface PwaUpdateSnapshot {
  swState: ServiceWorkerLifecycleState;
  swVersion: string | null;
  updateAvailable: boolean;
  offlineReady: boolean;
  errorMessage: string | null;
}

type UpdateListener = () => void;

let snapshot: PwaUpdateSnapshot = {
  swState:
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? 'unregistered'
      : 'unsupported',
  swVersion: null,
  updateAvailable: false,
  offlineReady: false,
  errorMessage: null
};

let currentRegistration: ServiceWorkerRegistration | null = null;
const listeners = new Set<UpdateListener>();

function emit(next: PwaUpdateSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error en suscriptor de actualización PWA:', err);
    }
  }
}

export const PwaUpdateManager = {
  subscribe(listener: UpdateListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): PwaUpdateSnapshot {
    return snapshot;
  },

  setRegistering(): void {
    emit({
      ...snapshot,
      swState: 'registering',
      errorMessage: null
    });
  },

  setRegistered(registration: ServiceWorkerRegistration, version: string | null): void {
    currentRegistration = registration;
    const hasWaiting = Boolean(registration.waiting);
    emit({
      ...snapshot,
      swState: hasWaiting ? 'update_available' : 'registered',
      swVersion: version ?? snapshot.swVersion,
      updateAvailable: hasWaiting,
      offlineReady: true,
      errorMessage: null
    });
  },

  setUpdateAvailable(registration: ServiceWorkerRegistration): void {
    currentRegistration = registration;
    emit({
      ...snapshot,
      swState: 'update_available',
      updateAvailable: true,
      errorMessage: null
    });
  },

  setSwVersion(version: string): void {
    emit({
      ...snapshot,
      swVersion: version
    });
  },

  setRegistrationError(message: string): void {
    emit({
      ...snapshot,
      swState: 'error',
      errorMessage: message
    });
  },

  async checkForUpdates(): Promise<void> {
    if (!currentRegistration) return;
    try {
      await currentRegistration.update();
    } catch (err) {
      console.warn('No se pudo comprobar actualización del Service Worker (posible modo offline):', err);
    }
  },

  /**
   * Activa la nueva versión del Service Worker conservando IndexedDB intacta.
   * Advierte si existen formularios con datos sin guardar antes de recargar.
   */
  applyPendingUpdate(forceWithoutPrompt = false): boolean {
    if (!currentRegistration?.waiting) {
      return false;
    }

    if (!forceWithoutPrompt && typeof document !== 'undefined') {
      const hasDirtyFields = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      ).some((el) => {
        if (el instanceof HTMLInputElement) {
          if (
            el.type === 'hidden' ||
            el.type === 'search' ||
            el.type === 'checkbox' ||
            el.type === 'radio'
          ) {
            return false;
          }
        }
        return el.value.trim().length > 0;
      });
      if (hasDirtyFields) {
        const confirmed = window.confirm(
          'Hay campos editados en pantalla. Tus registros guardados en IndexedDB se conservarán, pero la vista se recargará para aplicar la actualización. ¿Continuar?'
        );
        if (!confirmed) {
          return false;
        }
      }
    }

    currentRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }
};
