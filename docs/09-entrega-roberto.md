# Entrega de la rama `inicio-sesion`

Esta rama integra los cambios de `develop`. Conserva el login JWT y Pull de `inicio-sesion`, y usa la implementación de Push y auditoría de `develop`.

## Trabajo incluido

- `POST /api/auth/login` (marcado explícitamente con `[AllowAnonymous]`) valida usuarios activos y contraseña, emite JWT e informa los ranchos asignados.
- Política global de autorización JWT (`FallbackPolicy`) en toda la API (solo `POST /api/auth/login` y `GET /health` son públicos).
- Aislamiento por rancho (`RanchAccessService` y `[RanchScope]`) en todos los controladores CRUD de dominio y `UsuarioRanchosController`, además de control de permisos en `UsuarioController`.
- `GET /api/sync/cambios` entrega cambios por rancho con cursor determinista `(OcurrioEn, IdCambio)`, paginación, bajas (`DELETE`, `eliminado: true`, `datos: null`) y validación de referencias en tratamientos (sin avanzar el cursor ante errores `422`). Requiere JWT y membresía activa.
- `POST /api/sync/operaciones`, `GET /api/sync/operaciones/{idOperacion}` y `GET /api/sync/auditoria` usan la implementación de Push/auditoría de `develop` sin modificaciones.
- `FarmDbContext` registra los cambios de dominio en `CambioServidor` y las operaciones idempotentes en `RegistroSyncServidor`.
- Las claves de las entidades de dominio y sus relaciones usan GUID (`char(36)` en MySQL). `Usuario.IdLegacy` conserva el ID entero previo.
- Pull y su alcance real están descritos en [08-contrato-sincronizacion.md](08-contrato-sincronizacion.md); Push y auditoría están en [sync-push-auditoria.md](sync-push-auditoria.md).

## Configuración por ambiente

No uses las credenciales locales de Angel en tu máquina ni las agregues al repositorio. Configura los valores con variables de entorno o `dotnet user-secrets`.

| Variable | Uso |
| --- | --- |
| `ConnectionStrings__FarmBovi` | Conexión MySQL. Ejemplo: `Server=localhost;Port=3306;Database=farmiboviDB;User ID=USUARIO_LOCAL;Password=CLAVE_LOCAL;` |
| `Jwt__SigningKey` | Clave aleatoria de al menos 32 bytes. En producción, almacén de secretos; no reutilizar la clave local de desarrollo. |
| `Jwt__Issuer` | Emisor del JWT; debe coincidir en el servidor que genera y valida tokens. |
| `Jwt__Audience` | Audiencia permitida para los clientes; debe coincidir con el emisor y cliente. |
| `Jwt__TokenMinutes` | Duración del token en minutos; valor predeterminado 60, limitado por la API al intervalo 5–1440. |
| `Cors__AllowedOrigins__0` | Primer origen del frontend, por ejemplo `http://localhost:5173`. Agrega `__1`, `__2`, etc. si hace falta. |

Ejemplo en PowerShell:

```powershell
$env:ConnectionStrings__FarmBovi = 'Server=localhost;Port=3306;Database=farmiboviDB;User ID=USUARIO_LOCAL;Password=CLAVE_LOCAL;'
$env:Jwt__SigningKey = 'USA_UN_SECRETO_ALEATORIO_DE_32_BYTES_O_MAS'
$env:Jwt__Issuer = 'FarmBovi.Api'
$env:Jwt__Audience = 'FarmBovi.Clients'
$env:Cors__AllowedOrigins__0 = 'http://localhost:5173'
```

Para guardar secretos localmente en vez de la sesión actual:

```powershell
dotnet user-secrets init --project BackEnd
dotnet user-secrets set --project BackEnd ConnectionStrings:FarmBovi 'Server=localhost;Port=3306;Database=farmiboviDB;User ID=USUARIO_LOCAL;Password=CLAVE_LOCAL;'
dotnet user-secrets set --project BackEnd Jwt:SigningKey 'USA_UN_SECRETO_ALEATORIO_DE_32_BYTES_O_MAS'
dotnet user-secrets set --project BackEnd Jwt:Issuer 'FarmBovi.Api'
dotnet user-secrets set --project BackEnd Jwt:Audience 'FarmBovi.Clients'
```

`appsettings.Development.json` incluye una clave únicamente para desarrollo local. No la uses en producción. La API no inicia si faltan emisor, audiencia o clave JWT válida.

## Migraciones y base de datos

La migración integrada de sincronización es `20261116232038_AddSincronizacionYAuditoriaModels`. Antes de aplicarla a una base con datos, respalda la base y revisa [la estrategia de migración](sync-push-auditoria.md#estrategia-de-migración-y-reversión-down): convierte claves existentes a GUID y no admite una reversión automática.

```powershell
dotnet ef database update --project BackEnd --startup-project BackEnd
```

Al iniciar con `ASPNETCORE_ENVIRONMENT=Development` la API también ejecuta migraciones automáticamente y expone Swagger. En producción hay que aplicar migraciones explícitamente antes del despliegue.

## Cuidado al integrar

- La sincronización Push/auditoría integrada usa `RegistroSyncServidor`; evita reintroducir el registro alternativo `RegistroOperacionSync` de la implementación anterior de esta rama.
- Revisa el historial de migraciones antes de aplicar el cambio en una base existente.
- No confirmes contraseñas, claves JWT reales ni cadenas de conexión personales.
- El cliente debe guardar el cursor de Pull sin modificarlo, generar un `idOperacion` estable por operación y enviar la versión base para actualizar o eliminar.
