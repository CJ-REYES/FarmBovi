# Contrato de sincronización

La rama conserva el Login y el endpoint Pull de `inicio-sesion`, e integra Push y auditoría con la implementación de `develop`. Los dos flujos comparten el historial `CambioServidor`.

## Autenticación

`POST /api/auth/login` recibe:

```json
{ "correo": "angel@example.com", "contrasena": "..." }
```

Devuelve un JWT y los ranchos activos que tiene asignados el usuario. Las credenciales inválidas devuelven `401`. `api/usuarios` y las rutas de sincronización requieren `Authorization: Bearer {token}`.

## CambioServidor

| Campo | Regla |
| --- | --- |
| `IdCambio` | UUID generado por el servidor. |
| `IdRancho` | Rancho propietario del dato. |
| `Entidad` | `Animal`, `Lote`, `EventoSanitario`, `Tratamiento`, `Recordatorio`, `Alimentacion` o `MovimientoAnimal`. |
| `IdRegistro` | UUID del registro afectado. |
| `Operacion` | `Crear`, `Actualizar` o `Eliminar`. |
| `Version` | Versión resultante del registro, inicia en 1 y aumenta por actualización o baja. |
| `OcurrioEn` | Fecha/hora UTC asignada por el servidor. |
| `IdUsuario` | Usuario asociado al cambio, cuando está disponible. |
| `IdOperacion` / `Origen` | Identifican la operación de Push y su origen cuando aplica. |
| `Antes` / `Despues` / `Datos` | Instantáneas usadas para auditoría y Pull; `Datos` es `null` en eliminaciones. |

Los cambios de una entidad y su fila `CambioServidor` se guardan en el mismo `SaveChanges`/transacción. La versión es token de concurrencia. El índice único por rancho, entidad, registro y versión evita registrar dos veces la misma versión.

## Pull

```http
GET /api/sync/cambios?idRancho={uuid}&cursor={cursor-opaco}&limite={1..500}
Authorization: Bearer {token}
```

El servidor comprueba la membresía activa del usuario en el rancho. Sin token responde `401`; sin membresía, `403`. El límite predeterminado es 100. Los resultados se ordenan por `(OcurrioEn, IdCambio)` para que fechas iguales no causen saltos. La respuesta es:

```json
{
  "cambios": [],
  "siguienteCursor": "cursor-opaco-o-null",
  "hayMas": false
}
```

El cliente guarda y reenvía `siguienteCursor` sin modificarlo. Las bajas se entregan como cambios con `operacion: "Eliminar"` y `datos: null`.

## Push y auditoría

Push se implementa en `POST /api/sync/operaciones`; el estado de una operación se consulta en `GET /api/sync/operaciones/{idOperacion}` y el historial en `GET /api/sync/auditoria`. La implementación de `develop` define la validación, idempotencia, concurrencia y estructura de respuestas. Consulta [la documentación de Push y auditoría](sync-push-auditoria.md) para el contrato completo.

## Base de datos y migraciones

La migración integrada es `20261116232038_AddSincronizacionYAuditoriaModels`; crea el registro de idempotencia y el historial de auditoría, y convierte el esquema existente a claves GUID. La conversión puede afectar datos existentes: respalda la base y revisa [la estrategia de migración](sync-push-auditoria.md#estrategia-de-migración-y-reversión-down) antes de aplicarla.
