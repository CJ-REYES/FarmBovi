# Contrato de sincronización

El backend comparte un único registro `CambioServidor` entre Pull y Push. Angel conserva Login/Pull; Push usa el mismo contrato y lo registra el `FarmDbContext` al guardar la entidad.

## Autenticación

`POST /api/auth/login` recibe:

```json
{ "correo": "angel@example.com", "contrasena": "..." }
```

Devuelve un JWT y los ranchos activos que tiene asignados el usuario. Las credenciales inválidas devuelven `401`. `api/usuarios` y ambas rutas de sincronización requieren `Authorization: Bearer {token}`.

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
| `IdUsuario` | Usuario autenticado, cuando la solicitud tiene identidad. |
| `Datos` | Instantánea JSON en altas y cambios; `null` en eliminaciones. |

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

## Push

```http
POST /api/sync/operaciones
Authorization: Bearer {token}
```

Solicitud para crear:

```json
{
  "idOperacion": "uuid-generado-por-dispositivo",
  "idRancho": "uuid",
  "idDispositivo": "identificador-del-dispositivo",
  "entidad": "Animal",
  "idRegistro": "uuid-del-registro",
  "operacion": "Crear",
  "versionBase": null,
  "datos": { "arete": "A-1", "raza": "Holstein", "sexo": "Hembra", "fechaIngreso": "2026-11-16T00:00:00Z", "procedencia": "Local", "estado": "Activo" }
}
```

`Actualizar` y `Eliminar` requieren `versionBase`. El servidor obtiene el usuario del JWT, comprueba su membresía en `idRancho`, valida que el registro pertenezca a ese rancho y no acepta cambios de rancho, autor, identificador o versión desde `datos`.

La primera operación aplicada devuelve `201` para Crear y `200` para Actualizar/Eliminar; la respuesta contiene `idCambio`, versión, fecha y datos resultantes. Repetir el mismo `idOperacion` con la misma solicitud devuelve la respuesta previa con `duplicadoIgnorado: true`, sin producir un segundo cambio. Reutilizar el identificador con contenido distinto devuelve `409`. Una `versionBase` obsoleta o una baja concurrente devuelve `409` con el estado y versión actuales del servidor. Rechazos y conflictos no producen entradas de cambio.

## Base de datos y migraciones

Las migraciones de sincronización agregan el registro de idempotencia, el índice de unicidad de cambios y la columna GUID de usuario. La migración de usuario conserva el identificador entero anterior en `IdLegacy`; no elimina la cuenta ni su hash de contraseña. `AlignDomainGuidKeys` ajusta las claves y relaciones de Rancho, UsuarioRancho y las entidades de dominio a GUID, además de alinear las columnas de creación con el modelo. Incluye una precondición que cancela la migración si encuentra registros en las tablas de dominio que transforma; respalda esos datos antes de planear una conversión con filas existentes.

En `farmiboviDB` se verificó que las tablas de dominio estaban vacías antes de aplicar esa migración. Después se crearon `Rancho Angel` y su asignación activa como Administrador para Angel. El ID entero anterior del usuario sigue disponible en `Usuario.IdLegacy`.
