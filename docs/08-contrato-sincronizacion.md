# Contrato de sincronización

La rama conserva el Login y el endpoint Pull de `inicio-sesion`, e integra Push y auditoría con la implementación de `develop`. Los dos flujos comparten el historial `CambioServidor`.

## Autenticación y autorización

Toda la API exige autenticación JWT mediante una política global (`FallbackPolicy`), con dos únicas excepciones públicas marcadas con `[AllowAnonymous]`:

- `POST /api/auth/login`
- `GET /health` (sonda de estado, sin datos de negocio)

`POST /api/auth/login` recibe:

```json
{ "correo": "angel@example.com", "contrasena": "..." }
```

Respuesta exitosa (`200 OK`):

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiraEn": "2026-11-18T04:00:00Z",
  "idUsuario": "11111111-1111-4111-8111-111111111111",
  "nombre": "Angel",
  "ranchos": [
    {
      "idRancho": "22222222-2222-4222-8222-222222222222",
      "nombre": "Rancho El Roble",
      "rol": "Admin"
    }
  ]
}
```

Las credenciales incorrectas o usuarios con estado distinto de `Activo` devuelven `401 Unauthorized`.

Todas las rutas protegidas requieren `Authorization: Bearer {token}`. Los tokens ausentes, malformados, con firma inválida, emisor/audiencia distintos o vencidos son rechazados con `401 Unauthorized`. El acceso a recursos de un rancho sin membresía activa devuelve `403 Forbidden`.

## CambioServidor

| Campo | Regla |
| --- | --- |
| `IdCambio` | UUID generado por el servidor. |
| `IdRancho` | Rancho propietario del dato. |
| `Entidad` | Entidad del modelo servidor. |
| `IdRegistro` | UUID del registro afectado. |
| `Operacion` | `Crear`, `Actualizar` o `Eliminar`. |
| `Version` | Versión resultante del registro; inicia en 1 y aumenta por actualización o baja. |
| `OcurrioEn` | Fecha/hora UTC asignada por el servidor. |
| `IdUsuario` | Usuario asociado al cambio, cuando está disponible. |
| `IdOperacion` / `Origen` | Identifican la operación de Push y su origen cuando aplica (`PUSH` o `API`). |
| `Antes` / `Despues` / `Datos` | Instantáneas usadas para auditoría y Pull; `Datos` es `null` en eliminaciones. |

Los cambios de una entidad y su fila `CambioServidor` se guardan en el mismo `SaveChanges`/transacción. La versión es token de concurrencia. El índice único por rancho, entidad, registro y versión evita registrar dos veces la misma versión.

## Alcance real de Pull

No todas las tablas locales de IndexedDB tienen representación en el servidor. El endpoint Pull cubre únicamente las entidades con modelo remoto existente:

| Entidad cliente (IndexedDB) | Entidad(es) Backend | Estado en Pull | Notas de mapeo |
| --- | --- | --- | --- |
| `cattle` | `Animal` | Habilitada | Campos de identificación, raza, sexo, nacimiento, lote y rancho. |
| `lots` | `Lote` | Habilitada | Nombre, capacidad y ubicación del lote. |
| `healthRecords` | `EventoSanitario` y `Tratamiento` | Habilitada | Los tratamientos se proyectan como registro sanitario usando el `IdAnimal` del evento sanitario asociado en el mismo rancho. |
| `feedingRecords` | `Alimentacion` | Habilitada | Tipo de alimento, cantidad, fecha y referencia a lote o animal. |
| `movements` | `MovimientoAnimal` | Habilitada | Animal, fecha, motivo y lotes origen/destino. |
| `alerts` | `Recordatorio` | Habilitada | Tipo, mensaje, fecha programada, prioridad y estado de lectura. |
| `weighings` | — (solo IndexedDB) | No habilitada | Requiere crear modelo remoto `Pesaje` (`IdPesaje`, `IdAnimal`, `PesoKg`, `Fecha`, `IdRancho` o derivación por animal, `VersionRegistro`, `EliminadoEn`) y su registro en `CambioServidor`. |
| `genealogy` | `GenealogiaAnimal` (API + `CambioServidor`) | No habilitada en Pull/Push | Modelo remoto `GenealogiaAnimal` (`IdGenealogia`, `IdAnimal`, `IdPadre`, `IdMadre`, `VersionRegistro`, `EliminadoEn`) ya integrado en `FarmDbContext.IsSynchronizableEntity()` para emitir `CambioServidor`; falta habilitar el mapeo `genealogy` en los contratos Push/Pull. |
| `reproductionRecords` | — (solo IndexedDB) | No habilitada | Requiere crear modelo remoto `EventoReproductivo` (`IdEventoReproductivo`, `IdAnimal`, `Tipo`, `Fecha`, `Resultado`, `VersionRegistro`, `EliminadoEn`). |
| `media` | — (solo IndexedDB) | No habilitada | Requiere almacenamiento binario/URI y modelo remoto `ArchivoMultimedia` (`IdMedia`, `IdRancho`, `EntidadRelacionada`, `IdRegistro`, `MimeType`, `Url`/`Hash`, `VersionRegistro`, `EliminadoEn`). |

Solicitar cualquiera de las entidades no habilitadas (`weighings`, `genealogy`, `reproductionRecords`, `media`) devuelve `400 Bad Request`.

## Pull

```http
GET /api/sync/cambios?entidad={cattle|lots|healthRecords|feedingRecords|movements|alerts}&ranchId={uuid}&cursorOpaco={cursor-opaco}&limite={1..500}
Authorization: Bearer {token}
```

El servidor comprueba la membresía activa del usuario en el rancho. Sin token responde `401`; sin membresía activa, `403`. También acepta `idRancho` y `cursor` como alias. Si no se indica rancho, lo infiere solo cuando el usuario tiene exactamente una membresía activa (de lo contrario responde `400`). El límite predeterminado es 100 (acotado al rango 1–500). Los resultados de la entidad solicitada se ordenan de forma determinista por `(OcurrioEn, IdCambio)` para que fechas iguales no causen saltos ni duplicados entre páginas.

### Ejemplo de respuesta exitosa (`200 OK`)

```json
{
  "entidad": "cattle",
  "cambios": [
    {
      "remoteId": "33333333-3333-4333-8333-333333333333",
      "clientUuid": null,
      "operacion": "UPSERT",
      "versionServidor": 1,
      "datos": {
        "ranchId": "22222222-2222-4222-8222-222222222222",
        "areteSiniiga": "A-1",
        "gender": "Hembra"
      },
      "eliminado": false,
      "actualizadoEnServidor": "2026-11-17T10:00:00Z"
    },
    {
      "remoteId": "44444444-4444-4444-8444-444444444444",
      "clientUuid": null,
      "operacion": "DELETE",
      "versionServidor": 2,
      "datos": null,
      "eliminado": true,
      "actualizadoEnServidor": "2026-11-17T10:05:00Z"
    }
  ],
  "siguienteCursorOpaco": "MjAyNi0xMS0xN1QxMDowNTowMC4wMDAwMDAwWnw0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDQ",
  "hayMasPaginas": false,
  "fechaServidor": "2026-11-17T10:05:01Z"
}
```

El cliente debe guardar y reenviar `siguienteCursorOpaco` sin modificarlo. Las bajas se entregan siempre con `operacion: "DELETE"`, `eliminado: true` y `datos: null`.

### Manejo de errores y referencias inexistentes (no avanzar cursor)

- En `Tratamiento`, antes de construir un registro `healthRecords`, el servidor verifica que exista `IdEventoSanitario` en `EventosSanitarios` asociado a un animal del mismo rancho y que `FechaInicio` esté presente. Nunca se entrega un `UPSERT` con `datos: null`.
- Si ocurre un error de procesamiento en un cambio (por ejemplo `REFERENCIA_INEXISTENTE`, `DATOS_INCOMPLETOS`, `DATOS_INVALIDOS` u `OPERACION_DESCONOCIDA`):
  - Si ya se procesaron cambios válidos previos en la misma página, el servidor **corta la página justo antes del cambio fallido**, devuelve `200 OK` con esos cambios válidos, `hayMasPaginas: true` y `siguienteCursorOpaco` apuntando al último cambio válido entregado.
  - Si el cambio fallido es el primero de la página, el servidor responde `422 Unprocessable Entity` con `cursorVigente` igual al cursor recibido:

```json
{
  "codigo": "REFERENCIA_INEXISTENTE",
  "mensaje": "El evento sanitario 55555555-5555-4555-8555-555555555555 del tratamiento no existe en el rancho solicitado.",
  "entidad": "healthRecords",
  "idCambio": "66666666-6666-4666-8666-666666666666",
  "entidadServidor": "Tratamiento",
  "remoteId": "77777777-7777-4777-8777-777777777777",
  "cursorVigente": "MjAyNi0xMS0xN1QxMDowMDowMC4wMDAwMDAwWnwzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzM"
}
```

El cliente no debe avanzar su cursor local ante una respuesta `422`. Una vez corregida la referencia en el servidor, el siguiente Pull desde `cursorVigente` entregará el cambio pendiente sin saltos.

## Push y auditoría

Push se implementa en `POST /api/sync/operaciones`; el estado de una operación se consulta en `GET /api/sync/operaciones/{idOperacion}` y el historial en `GET /api/sync/auditoria`. La implementación de `develop` define la validación, idempotencia, concurrencia y estructura de respuestas. Consulta [la documentación de Push y auditoría](sync-push-auditoria.md) para el contrato completo.

## Base de datos y migraciones

La migración integrada es `20261116232038_AddSincronizacionYAuditoriaModels`; crea el registro de idempotencia y el historial de auditoría, y convierte el esquema existente a claves GUID. La conversión puede afectar datos existentes: respalda la base y revisa [la estrategia de migración](sync-push-auditoria.md#estrategia-de-migración-y-reversión-down) antes de aplicarla.
