import { PwaUpdateManager } from './update-manager';
import { SyncScheduler } from '../services/sync/sync-scheduler';

let registeredOnce = false;

async function queryWorkerVersion(worker: ServiceWorker | null): Promise<string | null> {
  if (!worker) return null;

  return await new Promise<string | null>((resolve) => {
    const channel = new MessageChannel();
    const timeoutId = window.setTimeout(() => resolve(null), 1500);

    channel.port1.onmessage = (event: MessageEvent<{ type?: string; version?: string }>) => {
      window.clearTimeout(timeoutId);
      if (event.data?.type === 'SW_VERSION' && typeof event.data.version === 'string') {
        resolve(event.data.version);
      } else {
        resolve(null);
      }
    };

    try {
      worker.postMessage({ type: 'GET_SW_VERSION' }, [channel.port2]);
    } catch {
      window.clearTimeout(timeoutId);
      resolve(null);
    }
  });
}

export function registerFarmBoviServiceWorker(): void {
  if (registeredOnce || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  registeredOnce = true;

  // Escuchar mensajes enviados desde src/pwa/sw.ts (ej. solicitud de Background Sync)
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
    if (event.data?.type === 'BACKGROUND_SYNC_REQUESTED') {
      void SyncScheduler.triggerSync('online_recovered');
    }
  });

  // Recargar una única vez cuando el nuevo Service Worker toma el control tras SKIP_WAITING
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void (async () => {
      PwaUpdateManager.setRegistering();
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });

        const activeVersion = await queryWorkerVersion(
          registration.active ?? navigator.serviceWorker.controller
        );
        PwaUpdateManager.setRegistered(registration, activeVersion);

        if (registration.waiting) {
          PwaUpdateManager.setUpdateAvailable(registration);
        }

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', () => {
            if (
              installingWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              PwaUpdateManager.setUpdateAvailable(registration);
            }
          });
        });

        // Verificar actualizaciones de forma discreta al regresar a primer plano
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            void PwaUpdateManager.checkForUpdates();
          }
        });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'No fue posible registrar el Service Worker.';
        PwaUpdateManager.setRegistrationError(msg);
      }
    })();
  });
}
