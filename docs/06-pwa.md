# 06. PWA y Service Worker

La bitácora describe `vite-plugin-pwa` con estrategia `injectManifest` y un Service Worker propio.

## Archivos mencionados
- `FrontEnd/public/manifest.webmanifest`
- `FrontEnd/src/pwa/sw.ts`
- `FrontEnd/src/pwa/registerSW.ts`
- `FrontEnd/src/pwa/update-manager.ts`
- `FrontEnd/src/hooks/usePwaUpdate.ts`
- `FrontEnd/vite.config.ts`

## Manifiesto
Se declaran `id`, `start_url`, `scope`, `display: standalone`, colores y recursos de iconos 192, 512 y maskable. La bitácora dice que se retiró `display_override` para superar una validación.

## Service Worker
La bitácora describe precache con `precacheAndRoute(self.__WB_MANIFEST)`, fallback de navegación SPA, `NetworkOnly` para `/api/*`, estrategias de caché para recursos estáticos, limpieza de cachés anteriores y mensajes para activar/consultar versión.

Verifica `sw.ts` y la configuración real. No caches datos privados de API sin política explícita.

## Actualizaciones e instalación
La aplicación debe evitar recargar mientras existan cambios sin guardar. En iOS/iPadOS la fuente indica instalación manual desde Compartir → Agregar a inicio. Una PWA no es una aplicación nativa.
