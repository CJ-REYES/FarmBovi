# 13. Validación y pruebas

El README fuente declara validaciones `npm run lint`, `npm run typecheck` y `npm run build`, además de pruebas CRUD con EF Core InMemory. No se adjuntaron salidas de ejecución; se registra como validación declarada, no como evidencia independiente.

## Comandos

En `FrontEnd/`, si existen en `package.json`:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
```

En la raíz:

```bash
dotnet restore FarmBovi.sln --locked-mode
dotnet test FarmBovi.sln
```

## Matriz de pruebas recomendada

| Área | Escenario | Resultado esperado |
|---|---|---|
| Instalación | Instalar PWA | Abre en modo esperado |
| Offline | Abrir sin red | App Shell disponible |
| Persistencia | Guardar, cerrar y reabrir | Dato local permanece |
| Outbox | Crear operación offline | Queda pendiente |
| Reconexión | Recuperar red | Se inicia sincronización |
| Idempotencia | Reintentar operación | No duplica en servidor |
| Pull | Recibir cambios | Aplica antes del checkpoint |
| Conflicto | Editar desde dos dispositivos | Conserva y presenta conflicto |
| Medios | Capturar imagen offline | Archivo queda pendiente |
| BoviScale | Reanudar análisis | No inventa resultado |
| Cuota | Agotar almacenamiento | Error visible, sin pérdida silenciosa |
| Permisos | Denegar cámara/ubicación | Alternativa razonable |
| Actualización | Nueva versión con edición abierta | No descarta cambios |

Las pruebas InMemory no prueban sincronización entre dispositivos. Para ello se requieren backend operativo y clientes con bases locales independientes. Registra fecha, entorno, versión, comando y evidencia por cada resultado aprobado.
