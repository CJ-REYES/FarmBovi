# Entrega de la rama `inicio-sesion` para Roberto

Esta rama concentra el trabajo de Angel en login, seguridad de endpoints, sincronización y esquema GUID. Está pensada para publicarse como rama remota independiente; no está integrada a `develop`.

## Trabajo incluido

- `POST /api/auth/login` valida usuarios activos y contraseña, emite JWT e informa los ranchos asignados.
- `GET /api/sync/cambios` entrega cambios por rancho con cursor, paginación y bajas. Requiere JWT y membresía activa.
- `POST /api/sync/operaciones` recibe altas, actualizaciones y bajas lógicas; valida rancho/membresía, controla versiones e ignora reintentos idempotentes.
- `FarmDbContext` registra cada cambio de dominio en `CambioServidor` junto con la operación de negocio.
- `api/usuarios` requiere autenticación.
- Las claves de las entidades de dominio y sus relaciones usan GUID (`char(36)` en MySQL). `Usuario.IdLegacy` conserva el ID entero previo.
- La especificación de los endpoints está en [08-contrato-sincronizacion.md](08-contrato-sincronizacion.md).

La autenticación aún no cubre todos los controladores CRUD de dominio y ranchos. Antes de exponer toda la API a usuarios externos, revisa y aplica autorización también a esas rutas según los roles acordados.

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

La base local `farmiboviDB` ya tiene aplicadas estas migraciones, incluida `20261116103052_AlignDomainGuidKeys`. En una base nueva o de integración, revisa el historial y aplica las migraciones:

```powershell
dotnet ef database update --project BackEnd --startup-project BackEnd
```

Al iniciar con `ASPNETCORE_ENVIRONMENT=Development` la API también ejecuta migraciones automáticamente y expone Swagger. En producción hay que aplicar migraciones explícitamente antes del despliegue.

**Atención con bases que ya contienen datos:** `AlignDomainGuidKeys` detiene la migración si encuentra filas en las tablas de dominio que convierte. En la base de Angel dichas tablas estaban vacías; la cuenta de Angel se conservó y su ID entero quedó en `Usuario.IdLegacy`. Si tu base tiene ranchos, lotes, animales u otros registros, haz respaldo y acuerda la conversión de cada clave y relación antes de aplicar cambios. No cambies IDs enteros a texto esperando que sean GUID válidos.

La base local contiene `Rancho Angel`, su membresía activa como `Administrador` y un lote creado durante la prueba real de Push/Pull. Angel usa el correo escrito al crear la cuenta (`angel@gamil.com`); la contraseña no se documenta ni se comparte.

## Verificación realizada

- `dotnet build BackEnd/FarmBovi.Api.csproj -c Codex --no-restore`: correcto.
- `dotnet run --project BackEnd.Tests/BackEnd.Tests.csproj -c Codex --no-build`: 27 comprobaciones HTTP correctas.
- `dotnet ef migrations has-pending-model-changes`: sin cambios pendientes.
- Prueba HTTP con MySQL: Login respondió `200`, la respuesta incluyó el rancho, Push creó un lote en versión 1, el reintento se marcó como duplicado y Pull devolvió el cambio.

La advertencia `NU1900` durante el build aparece porque no se pudo consultar NuGet para información de vulnerabilidades; no impidió compilar ni ejecutar las pruebas.

## Cuidado al integrar

- Mantén este trabajo en `inicio-sesion` mientras Roberto lo revisa; el push remoto crea una rama nueva y no cambia `develop`.
- Revisa conflictos de modelos y migraciones si otra rama modifica `FarmDbContext`, `Usuario` o las tablas de dominio.
- No confirmes contraseñas, claves JWT reales ni cadenas de conexión personales.
- El cliente debe guardar el cursor de Pull sin modificarlo, generar un `idOperacion` estable por operación y enviar la versión base para actualizar o eliminar.
