# API y base de datos

La API ASP.NET Core .NET 10 usa Entity Framework Core 10 con el proveedor oficial `MySql.EntityFrameworkCore` 10.0.12. La cadena de conexión se lee de `ConnectionStrings:FarmBovi` y puede sobrescribirse mediante `ConnectionStrings__FarmBovi`.

## Preparar MySQL

Crea la base antes de iniciar la API (la cuenta de conexión necesita permisos para crear y modificar tablas):

```sql
CREATE DATABASE farmbovi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Configura la conexión con variable de entorno para no guardar credenciales reales en Git:

```powershell
$env:ConnectionStrings__FarmBovi = 'Server=localhost;Port=3306;Database=farmbovi;User ID=farmbovi;Password=CAMBIA_ESTA_CLAVE;'
dotnet run --project BackEnd
```

En desarrollo la API aplica migraciones al arrancar. En producción aplica `dotnet ef database update --project BackEnd --startup-project BackEnd` durante el despliegue, antes de iniciar la nueva versión.

## Controladores CRUD

Todos los recursos tienen `GET` para colección y elemento, `POST`, `PUT` y `DELETE`. Las claves se generan en la base.

| Modelo | Ruta | Clave |
| --- | --- | --- |
| Animal | `/api/animales` | `IdAnimal` |
| Lote | `/api/lotes` | `IdLote` |
| Rancho | `/api/ranchos` | `IdRancho` |
| Usuario | `/api/usuarios` | `Id` |
| UsuarioRancho | `/api/usuario-ranchos` | `IdUsuarioRancho` |

Las respuestas habituales son `200` para consultas, `201` al crear, `204` al actualizar o eliminar, `404` si la clave no existe y `400` si la validación del request falla. Las contraseñas se reciben como `Contrasena`, se guardan con hash y nunca se devuelven en el CRUD de usuarios.

### Inicio de sesión

`POST /api/usuarios/login` recibe `{ "correo": "...", "contrasena": "..." }`. Si las credenciales son válidas y la cuenta está activa, responde con un JWT bearer de ocho horas y datos públicos del usuario; las credenciales incorrectas responden `401` sin revelar si existe el correo. El resto de rutas requiere `Authorization: Bearer <token>`. Crear usuarios también requiere sesión.

En producción define `Authentication__SigningKey` mediante un gestor de secretos con al menos 32 bytes. En Development se genera una clave aleatoria temporal cuando falta la configuración; los tokens dejan de ser válidos después de reiniciar la API. La identidad ya está implementada; todavía falta aplicar permisos por rancho a cada recurso.

### Historial de cambios

La migración `AddServerChangeLog` agrega `CambioServidor`. El contexto registra en la misma operación de base de datos las altas, ediciones y eliminaciones, junto con entidad, clave, rancho, fecha UTC y una copia JSON de los datos. Para eventos sanitarios, tratamientos, movimientos y alimentación, el rancho se obtiene a través del animal relacionado. El endpoint paginado que expondrá estos cambios se documenta al completar la actividad 3.

`GET /api/sync/cambios?cursor=<cursor>&limite=100` requiere JWT. Omite `cursor` para la primera página; el máximo es 200. Solo devuelve cambios de ranchos con asignación activa del usuario del token. La respuesta incluye cada cambio (`idCambio`, `entidad`, `idRegistro`, `idRancho`, `operacion`, `ocurrioEn`, `datos`), un `cursorSiguiente` firmado y `hayMas`. Los borrados llegan como `operacion: "eliminar"`, porque permanecen en el historial aunque el registro original ya no exista. El motor web guarda cada lote en `serverChanges` y actualiza el cursor por usuario dentro de la misma transacción IndexedDB; las eliminaciones marcan la fila sincronizada local como eliminada cuando existe. Las altas y modificaciones permanecen en la bandeja duradera a la espera de integración con cada módulo.

Las relaciones entre animal, lote y rancho, y entre usuario y rancho, tienen claves foráneas. Los aretes y nombres de lote son únicos dentro de cada rancho; el correo y la asignación usuario-rancho también son únicos.

## Esquema y cambio desde SQLite

La migración `InitialMySqlModels` crea las cinco tablas para MySQL. La migración previa creaba una tabla SQLite `Cattle` y no es compatible con este esquema. Cambiar el proveedor no copia los datos existentes: exporta y transforma los registros de SQLite por separado antes de usar información que necesites conservar.

Para crear una migración después de modificar los modelos:

```powershell
dotnet ef migrations add NombreDelCambio --project BackEnd --startup-project BackEnd
```

Revisa la migración y aplícala con `dotnet ef database update --project BackEnd --startup-project BackEnd`.

## Pruebas

Ejecuta las pruebas de los cinco controladores con:

```powershell
dotnet run --project BackEnd.Tests
```

El verificador usa EF Core InMemory y comprueba las acciones CRUD; no sustituye una prueba de integración contra una instancia MySQL.
