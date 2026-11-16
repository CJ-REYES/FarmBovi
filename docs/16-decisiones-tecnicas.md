# 16. Decisiones técnicas

## `injectManifest`
La bitácora describe un Service Worker propio con Workbox para controlar precache, navegación offline, actualización y mensajes. Consecuencia: el SW y su compilación requieren pruebas específicas y debe conservarse el marcador de precache que espera Workbox.

## Dexie e IndexedDB
Se elige persistencia local para permitir operaciones offline. Consecuencia: gestionar versiones de esquema, transacciones, cuota, migraciones locales y recuperación.

## Outbox
Se usa una cola local para desacoplar captura de disponibilidad de API. Cada operación necesita identidad estable, estados claros e idempotencia en servidor.

## Push y Pull
Se separa el envío de operaciones locales de la recepción de cambios remotos. No debe declararse sincronización completa si solo terminó una dirección; el checkpoint se avanza después de aplicar cambios.

## Conflictos explícitos
La bitácora propone conservar conflictos multidispositivo y presentarlos para resolución, en vez de sobrescribir silenciosamente.

## API fuera de caché genérica
La estrategia descrita para `/api/*` es `NetworkOnly`, evitando servir datos dinámicos desde caché estática sin política de frescura y seguridad.

## BoviScale offline
Guardar foto y metadatos, diferir análisis y no inventar peso. Las credenciales del proveedor deben permanecer en backend.

## Decisiones todavía no formalizadas
La fuente no define por completo la política de conflictos, contrato Push/Pull, autenticación, carga multimedia, proveedor/contrato IA ni retención de datos locales. Deben resolverse antes de declarar el sistema listo para producción.
