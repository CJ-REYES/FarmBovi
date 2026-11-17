# Sincronización Push y Auditoría (Módulo 7)

Documentación técnica de los endpoints de **Push**, **idempotencia**, **concurrencia optimista**, **resolución de conflictos** y **auditoría** implementados en [SincronizacionController.cs](../BackEnd/Controllers/SincronizacionController.cs), compatibles con el Pull (`GET /api/sync/cambios`) y el modelo único [CambioServidor](../BackEnd/Models/CambioServidor.cs).

## 1. Seguridad, Usuario, Rancho y Dispositivo

Todos los endpoints bajo `/api/sync` requieren `Authorization: Bearer <JWT>`:

1. **Usuario:** se extrae exclusivamente de los claims del JWT (`ClaimTypes.NameIdentifier` / `sub`) y se verifica que exista y esté `Activo` en `Usuario`. Cualquier `idUsuario` enviado en el body es ignorado.
2. **Rancho:** se valida en `UsuarioRancho` que el usuario autenticado tenga membresía activa (`Estado = "Activo"`, `FechaBaja = null`) sobre el `idRancho` solicitado (de lo contrario responde `403 Forbidden`). También se verifica que el registro objetivo y sus referencias foráneas pertenezcan a ese rancho.
3. **Dispositivo (`idDispositivo`):**
   - Es obligatorio (3 a 120 caracteres válidos `[A-Za-z0-9._:@\-]`).
   - Si el JWT incluye el claim `device_id` / `idDispositivo`, o si se envía la cabecera `X-Device-Id`, se exige coincidencia exacta (`403` / `400` si difiere).
   - **Limitación documentada (alcance v0.2.0):** al no existir aún una tabla formal de registro/atestación de dispositivos en el ERD, `idDispositivo` actúa como identificador de correlación y auditoría en `RegistroSyncServidor`, no como autenticación criptográfica de hardware. Para endurecerlo en una fase futura bastará con añadir una tabla `DispositivoUsuario` y emitir `device_id` en el JWT tras el registro inicial.

## 2. Contrato de Push: `POST /api/sync/operaciones`

### Solicitud
```json
{
  "idOperacion": "uuid-operacion",
  "idRancho": "uuid-rancho",
  "idDispositivo": "android-dev-01",
  "entidad": "Animal",
  "idRegistro": "uuid-registro",
  "operacion": "Crear | Actualizar | Eliminar",
  "versionBase": 1,
  "fechaLocal": "2026-11-16T03:00:00.000Z",
  "datos": {
    "arete": "MX-001",
    "raza": "Brangus",
    "sexo": "Macho",
    "procedencia": "Propio",
    "estado": "Activo"
  }
}
```
*(Se aceptan alias `accion` para `operacion` y `payload` para `datos`.)*

### Respuestas
- **`201 Created` (`Crear`) / `200 OK` (`Actualizar`, `Eliminar`):**
  ```json
  {
    "idOperacion": "uuid-operacion",
    "entidad": "Animal",
    "idRegistro": "uuid-registro",
    "operacion": "Actualizar",
    "version": 2,
    "idCambio": "uuid-cambio",
    "ocurrioEn": "2026-11-16T03:00:05.000Z",
    "duplicadoIgnorado": false,
    "datos": { "...": "..." }
  }
  ```
- **`200 OK` con `duplicadoIgnorado: true` (Idempotencia multi-instancia):**
  - El hash SHA-256 (`ComputeRequestHash`) se calcula sobre `IdUsuario (JWT) | IdRancho | IdDispositivo | Entidad | IdRegistro | Operacion | VersionBase | PayloadCanónico` (con claves JSON ordenadas alfabéticamente de forma recursiva).
  - La unicidad se garantiza en base de datos mediante la clave primaria `RegistroSyncServidor.IdOperacion` dentro de la misma transacción.
  - Ante `DbUpdateException` o `DbUpdateConcurrencyException` provocada por reintentos simultáneos entre múltiples instancias del servidor, se consulta `RegistroSyncServidor`: si `IdOperacion`, usuario, rancho y hash coinciden, se devuelve `200 OK` con el recibo previo (`duplicadoIgnorado: true`) en lugar de un `500` o `409 VERSION_MISMATCH`.
  - Si el mismo `idOperacion` llega con usuario, rancho, dispositivo o payload distinto, devuelve **`409 Conflict`** (`IDEMPOTENCY_HASH_MISMATCH`).
- **`409 Conflict` (`VERSION_MISMATCH` / `DELETED_ON_SERVER`):**
  - `VersionRegistro` está configurado con `.IsConcurrencyToken()` en `FarmDbContext`.
  - En conflictos de versión, la transacción hace rollback sin escribir en `CambioServidor`, reconstruye los cambios ocurridos desde `versionBase` consultando el historial de `CambioServidor` (`Antes` vs estado actual) y devuelve `versionServidor`, `camposModificados` (con soporte para objetos JSON anidados y arreglos) y `estadoServidor` completo.

## 3. Actualizaciones Parciales (Lista Blanca)

`ApplyPartialUpdate()` utiliza una lista blanca explícita (`AllowedUpdateProperties`) por entidad (`Animal`, `Lote`, `Rancho`, `EventoSanitario`, `Tratamiento`, `Recordatorio`, `Alimentacion`, `MovimientoAnimal`), bloqueando la modificación de claves primarias, `IdRancho`, `IdAutor`, `CreadoEn`, `VersionRegistro` y `EliminadoEn`.

## 4. Auditoría Única en `CambioServidor` y `GET /api/sync/auditoria`

- `FarmDbContext` intercepta tanto `SaveChanges()` como `SaveChangesAsync()` cubriendo las 8 entidades sincronizables (incluido `Rancho`).
- En operaciones Push, `SincronizacionController` pasa los metadatos (`IdOperacion`, `Origen = "PUSH"`, `Antes`, `Despues`, `Datos`) mediante `SetPendingPushMetadata(...)` para insertar **exactamente 1 fila** en `CambioServidor` dentro de la misma transacción que la mutación y `RegistroSyncServidor`.
- `GET /api/sync/auditoria?idRancho={uuid}&entidad={opcional}&limite={1..500}` requiere JWT y membresía activa en el rancho.

## 5. Pruebas Automatizadas

El proyecto `BackEnd.Tests` usa **xUnit** y se ejecuta con:
```bash
dotnet test FarmBovi.sln --configuration Release
```
Para hacer obligatoria la ejecución contra MySQL/MariaDB real (como en CI):
```bash
FARMBOVI_REQUIRE_REAL_DB=true dotnet test FarmBovi.sln --configuration Release
```
*(Si no se define `FARMBOVI_REQUIRE_REAL_DB=true` y no hay servidor MySQL/MariaDB accesible, los tests de integración MySQL se reportan explícitamente como `Skipped`.)*

## Estrategia de migración y reversión (`Down()`)

- La migración `20261116232038_AddSincronizacionYAuditoriaModels` es incremental sobre `20261116071310_InitialMySqlModels`: convierte las tablas existentes de claves `int` a `char(36)` (`Guid`) conservando filas y relaciones, y crea `RegistroSyncServidor` y `CambioServidor`.
- **Irreversibilidad explícita:** El método `Down()` lanza `NotSupportedException` de forma intencional. La conversión `int -> Guid` descarta los identificadores enteros originales (y los registros sincronizados offline nacen directamente con `Guid`), por lo que una reversión automática destruiría identidades o dejaría el esquema inconsistente.
- **Procedimiento de rollback:** Antes de aplicar esta migración en un entorno con datos, generar un respaldo completo (`mysqldump` / snapshot). En caso de requerir reversión, restaurar dicho respaldo en lugar de ejecutar `dotnet ef database update 20261116071310_InitialMySqlModels`.
