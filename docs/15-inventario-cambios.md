# 15. Inventario de cambios

Este inventario reproduce archivos que la bitácora declara creados o modificados. No certifica su presencia actual; compara con `git diff`, `git log` y el árbol de la rama.

## Creados según bitácora

| Archivo | Responsabilidad |
|---|---|
| `FrontEnd/public/manifest.webmanifest` | Manifiesto PWA |
| `FrontEnd/src/pwa/sw.ts` | Service Worker |
| `FrontEnd/src/pwa/registerSW.ts` | Registro SW |
| `FrontEnd/src/pwa/update-manager.ts` | Actualizaciones |
| `FrontEnd/src/services/connectivity.service.ts` | Conectividad |
| `FrontEnd/src/services/sync/sync-scheduler.ts` | Planificador |
| `FrontEnd/src/services/storage-persistence.service.ts` | Cuota y persistencia |
| `FrontEnd/src/services/device/device-capabilities.service.ts` | Capacidades |
| `FrontEnd/src/services/permissions/permissions-manager.service.ts` | Permisos |
| `FrontEnd/src/hooks/useSyncStatus.ts` | Estado de sync |
| `FrontEnd/src/hooks/usePwaUpdate.ts` | Estado de actualización |
| `FrontEnd/src/hooks/useDeviceCapabilities.ts` | Capacidades |
| `FrontEnd/src/hooks/usePermissionsStatus.ts` | Permisos |
| `FrontEnd/src/hooks/useStorageHealth.ts` | Salud de almacenamiento |
| `FrontEnd/src/components/shared/SyncStatusBadge.tsx` | Indicador sync |
| `FrontEnd/src/components/shared/ResponsiveDataView.tsx` | Vista adaptable |
| `FrontEnd/src/components/layout/MobileBottomNav.tsx` | Navegación móvil |
| `FrontEnd/src/components/settings/PermissionsAndCapabilitiesPanel.tsx` | Panel de permisos |

## Modificados según bitácora

`FrontEnd/vite.config.ts`, `FrontEnd/index.html`, `FrontEnd/src/index.css`, `FrontEnd/src/main.tsx`, `FrontEnd/src/App.tsx`, `FrontEnd/src/components/layout/AppShell.tsx`, `FrontEnd/src/components/shared/SyncStatusPanel.tsx`, `FrontEnd/src/components/shared/PwaStatus.tsx`, `FrontEnd/src/hooks/useConnectivity.ts`, `FrontEnd/src/services/sync/sync-engine.ts`, `README.md` y `docs/01-inicio.md` a `docs/07-validacion.md`.

## Evidencia pendiente
Por archivo añade estado real (creado/modificado/eliminado/renombrado), commit, PR, autor Git si está probado, descripción contrastada con diff y pruebas relacionadas. No infieras autoría personal.
