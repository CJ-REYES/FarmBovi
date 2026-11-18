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

## Controladores CRUD y autorización

Todos los endpoints de la API están protegidos por una política global de autorización JWT (`FallbackPolicy`). Las únicas rutas públicas (`[AllowAnonymous]`) son `POST /api/auth/login` y `GET /health`.

Además del token JWT válido, todos los controladores de dominio aplican aislamiento por rancho mediante `RanchAccessService` y `[RanchScope]`: cada usuario solo puede consultar o modificar registros pertenecientes a ranchos donde tenga una membresía activa (`UsuarioRancho` activo y sin `FechaBaja`). Las operaciones administrativas sobre `api/ranchos` (`PUT`/`DELETE`), `api/usuario-ranchos` y la gestión de otros usuarios en `api/usuarios` requieren rol administrador (`Admin`, `Administrador` o `Propietario`).

| Modelo | Ruta | Clave |
| --- | --- | --- |
| Animal | `/api/animales` | `IdAnimal` |
| Lote | `/api/lotes` | `IdLote` |
| Rancho | `/api/ranchos` | `IdRancho` |
| Usuario | `/api/usuarios` | `IdUsuario` |
| UsuarioRancho | `/api/usuario-ranchos` | `IdUsuarioRancho` |
| Alimentación | `/api/alimentacion` | `IdAlimentacion` |
| Evento sanitario | `/api/eventos-sanitarios` | `IdEventoSanitario` |
| Tratamiento | `/api/tratamientos` | `IdTratamiento` |
| Movimiento animal | `/api/movimientos-animales` | `IdMovimiento` |
| Recordatorio | `/api/recordatorios` | `IdRecordatorio` |

Las respuestas habituales son `200` para consultas, `201` al crear, `204` al actualizar o eliminar, `401` sin JWT o con token inválido/vencido, `403` si el usuario no tiene permisos sobre el rancho o recurso, `404` si la clave no existe y `400` si la validación del request falla. Las contraseñas se reciben como `Contrasena`, se guardan con hash y nunca se devuelven en las respuestas. Para cambiar la propia contraseña en `PUT /api/usuarios/{id}` se requiere `ContrasenaActual`.

## Inicio de sesión y sincronización Pull

Configura `Jwt__SigningKey` con una clave aleatoria de al menos 32 bytes, además de `Jwt__Issuer` y `Jwt__Audience`. En producción estos valores deben venir del entorno o del almacén de secretos; el archivo `appsettings.Development.json` incluye solo una clave local de desarrollo.

`POST /api/auth/login` recibe `{ "correo": "...", "contrasena": "..." }` y devuelve un JWT y los ranchos activos asignados al usuario. `GET /api/sync/cambios?idRancho={uuid}&cursor={cursor-opaco}&limite={1..500}` requiere `Authorization: Bearer {token}` y solo entrega cambios de ranchos a los que el usuario tiene acceso activo. La respuesta incluye `cambios`, `siguienteCursor` y `hayMas`; el cursor es opaco y debe reenviarse tal como se recibió. El límite predeterminado es 100.

`POST /api/sync/operaciones` recibe altas, actualizaciones y eliminaciones idempotentes. Actualizar o eliminar requiere `versionBase`; un conflicto de versión devuelve `409`. Los endpoints de `api/usuarios` también requieren JWT. Consulta [el contrato completo de sincronización](08-contrato-sincronizacion.md) para las estructuras de Push/Pull y las reglas de migración.

Los ambientes sin `Jwt:SigningKey`, `Jwt:Issuer` o `Jwt:Audience` configurados no inician la API. `CambioServidor` mantiene el historial compartido entre Pull, Push y auditoría.

Las relaciones entre animal, lote y rancho, y entre usuario y rancho, tienen claves foráneas. Los aretes y nombres de lote son únicos dentro de cada rancho; el correo y la asignación usuario-rancho también son únicos.

## Esquema y cambio desde SQLite

La migración `InitialMySqlModels` crea las cinco tablas para MySQL. La migración previa creaba una tabla SQLite `Cattle` y no es compatible con este esquema. Cambiar el proveedor no copia los datos existentes: exporta y transforma los registros de SQLite por separado antes de usar información que necesites conservar.

Para crear una migración después de modificar los modelos:

```powershell
dotnet ef migrations add NombreDelCambio --project BackEnd --startup-project BackEnd
```

Revisa la migración y aplícala con `dotnet ef database update --project BackEnd --startup-project BackEnd`.

## Pruebas

Ejecuta las pruebas automatizadas con:

```powershell
dotnet test FarmBovi.sln
```

El verificador usa EF Core InMemory y comprueba las acciones CRUD; no sustituye una prueba de integración contra una instancia MySQL.
