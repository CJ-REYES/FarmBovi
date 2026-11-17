# 14. Historial de desarrollo

## Alcance y atribución
Cronología reconstruida a partir de la bitácora compartida; no es una auditoría independiente de Git. La fuente distingue la base previa del backend (API .NET, CRUD, `FarmDbContext` y migraciones iniciales) de la refactorización PWA/offline. La autoría de la base previa se considera no verificada en la bitácora.

## Etapa 1: panel de conflictos
Se describe la extracción de `SyncConflictsPanel.tsx` desde `SyncStatusPanel.tsx` y la recarga inmediata de Outbox, checkpoints y conflictos al resolver.

## Etapa 2: scheduler y estados
Se describen `ConnectivityService`, `useConnectivity`, el uso de `/api/animales`, el criterio de éxito conjunto Push/Pull y la integración de `SyncScheduler`, `useSyncStatus` y `SyncStatusBadge`. También se narran correcciones de orden de hooks y desestructuración de `useState`.

## Etapa 3: PWA y capacidades
Se registra migración a `injectManifest`, Service Worker propio, registro y actualizaciones, detección de capacidades, salud de almacenamiento, permisos, navegación inferior móvil y vistas adaptables. También se mencionan ajustes de tipos del SW y validación del manifiesto.

## Etapa 4: diseño y documentación
Se describe la restauración de Tailwind CSS 4, plugin Vite y tokens `@theme`, además de revisión de README y guías técnicas.

## Pendientes mencionados
Endpoints Push/Pull, carga multipart, proxy IA BoviScale, autenticación/autorización, aislamiento por rancho, HTTPS y pruebas reales Android/iOS.

Para convertir esta narración en historial verificable, añade hashes, fechas, ramas, PR y archivos por etapa. No inventes autores ni fechas.
