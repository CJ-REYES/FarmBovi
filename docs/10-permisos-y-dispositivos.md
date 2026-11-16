# 10. Permisos y dispositivos

La bitácora menciona `DeviceCapabilitiesService`/`useDeviceCapabilities`, `PermissionsManagerService`/`usePermissionsStatus` y `PermissionsAndCapabilitiesPanel`.

## Capacidades
Se describen detección de móvil/tableta/escritorio, modo navegador/standalone, puntero, touch, movimiento reducido, particularidades iOS y disponibilidad de APIs. Prioriza capacidades reales sobre detección por nombre de dispositivo.

## Permisos
- **Cámara:** solicitar al iniciar captura; ofrecer selección de archivo como alternativa cuando sea posible.
- **Geolocalización:** pedir solo cuando la función la necesite y explicar el propósito.
- **Notificaciones:** disponibilidad dependiente de navegador, permiso y contexto.
- **Almacenamiento:** informar uso/cuota y límites del navegador.

La bitácora menciona estados granted, denied, prompt, unavailable y unknown. Confirma los nombres reales en código.

## Diseño adaptable
`MobileBottomNav` se describe como navegación táctil y `ResponsiveDataView` como vista de tarjetas en móvil y tablas en pantallas mayores. Verifica accesibilidad y tamaño de objetivos táctiles.
