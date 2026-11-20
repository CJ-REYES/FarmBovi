import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare global {
  interface Window {
    __WB_MANIFEST: Array<PrecacheEntry | string>;
  }
}

interface SwExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SwMessageEvent extends SwExtendableEvent {
  readonly data: unknown;
  readonly ports: ReadonlyArray<MessagePort>;
}

interface SwSyncEvent extends SwExtendableEvent {
  readonly tag: string;
}

interface SwNotificationEvent extends SwExtendableEvent {
  readonly notification: Notification;
}

interface SwWindowClient {
  readonly url: string;
  postMessage(message: unknown): void;
  focus?(): Promise<SwWindowClient>;
}

interface SwClients {
  claim(): Promise<void>;
  matchAll(options?: {
    type?: 'window' | 'worker' | 'sharedworker' | 'all';
    includeUncontrolled?: boolean;
  }): Promise<SwWindowClient[]>;
  openWindow?(url: string): Promise<SwWindowClient | null>;
}

interface CustomServiceWorkerScope {
  readonly location: Location;
  readonly clients: SwClients;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'activate', listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: 'message', listener: (event: SwMessageEvent) => void): void;
  addEventListener(type: 'sync', listener: (event: SwSyncEvent) => void): void;
  addEventListener(
    type: 'notificationclick',
    listener: (event: SwNotificationEvent) => void
  ): void;
}

const SW_VERSION = 'farmbovi-sw-3.0.0';
const STATIC_ASSETS_CACHE = 'farmbovi-static-assets-v3';
const FONT_ASSETS_CACHE = 'farmbovi-fonts-v3';
const EXPECTED_CACHES = new Set<string>([STATIC_ASSETS_CACHE, FONT_ASSETS_CACHE]);

const sw = self as unknown as CustomServiceWorkerScope;

function isPrivateOrApiRequest(url: URL, request: Request): boolean {
  if (request.method !== 'GET') return true;
  if (request.headers.has('authorization')) return true;
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname === '/health' || url.pathname.startsWith('/auth/')) return true;
  return false;
}

// 1. Precache del App Shell inyectado por vite-plugin-pwa (debe usar self.__WB_MANIFEST literal)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// 2. Navegación SPA offline (excluyendo rutas de API, sonda /health y archivos de control PWA)
const navigationHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [/^\/api\//, /^\/health$/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/]
});
registerRoute(navigationRoute);

// 3. Nunca almacenar en caché respuestas privadas, autenticadas o de la API ASP.NET Core
registerRoute(
  ({ url, request }) => isPrivateOrApiRequest(url, request),
  new NetworkOnly()
);

// 4. Caché controlada para fuentes tipográficas públicas
registerRoute(
  ({ request, url }) => !isPrivateOrApiRequest(url, request) && request.destination === 'font',
  new CacheFirst({
    cacheName: FONT_ASSETS_CACHE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 180
      })
    ]
  })
);

// 5. Caché controlada únicamente para imágenes y hojas de estilo públicas del mismo origen
registerRoute(
  ({ request, url }) =>
    url.origin === sw.location.origin &&
    !isPrivateOrApiRequest(url, request) &&
    (request.destination === 'image' || request.destination === 'style'),
  new StaleWhileRevalidate({
    cacheName: STATIC_ASSETS_CACHE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 60 * 24 * 30
      })
    ]
  })
);

// 5. Limpieza de cachés obsoletos en activación (sin tocar IndexedDB)
sw.addEventListener('activate', (event: SwExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (cacheName) =>
              !cacheName.startsWith('workbox-precache') &&
              !EXPECTED_CACHES.has(cacheName)
          )
          .map((cacheName) => caches.delete(cacheName))
      );
      await sw.clients.claim();
    })()
  );
});

// 6. Control explícito de actualizaciones y consulta de versión desde la interfaz
sw.addEventListener('message', (event: SwMessageEvent) => {
  const data = event.data as { type?: string } | undefined;
  if (!data?.type) return;

  if (data.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
    return;
  }

  if (data.type === 'GET_SW_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({
      type: 'SW_VERSION',
      version: SW_VERSION
    });
  }
});

// 7. Delegación ligera de Background Sync hacia el cliente activo (no duplica SyncEngine)
sw.addEventListener('sync', (event: SwSyncEvent) => {
  if (event.tag !== 'farmbovi-sync') return;

  event.waitUntil(
    (async () => {
      const windowClients = await sw.clients.matchAll({
        type: 'window',
        includeUncontrolled: false
      });
      for (const client of windowClients) {
        client.postMessage({ type: 'BACKGROUND_SYNC_REQUESTED' });
      }
    })()
  );
});

// 8. Apertura o enfoque de la aplicación al pulsar una notificación persistente
sw.addEventListener('notificationclick', (event: SwNotificationEvent) => {
  event.notification.close();
  const rawData = event.notification.data as { url?: unknown } | undefined;
  const targetUrl = typeof rawData?.url === 'string' ? rawData.url : '/';

  event.waitUntil(
    (async () => {
      const windowClients = await sw.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });
      for (const client of windowClients) {
        if (client.focus) {
          await client.focus();
          return;
        }
      }
      if (sw.clients.openWindow) {
        await sw.clients.openWindow(targetUrl);
      }
    })()
  );
});
