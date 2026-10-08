# API y base de datos

La API usa ASP.NET Core .NET 8 con controladores, Entity Framework Core 8 y SQLite. Para comenzar no necesitas SQL Server ni otra instalación de base de datos.

## Endpoints

Base local: `http://localhost:5080`.

| Método | Ruta | Respuesta correcta |
| --- | --- | --- |
| GET | `/api/cattle` | `200` con todos los bovinos, ordenados por arete |
| GET | `/api/cattle/{id}` | `200` con un bovino; `404` si no existe |
| POST | `/api/cattle` | `201` con el registro y cabecera `Location` |
| PUT | `/api/cattle/{id}` | `200` con el registro actualizado; `404` si no existe |
| DELETE | `/api/cattle/{id}` | `204` sin cuerpo; `404` si no existe |
| GET | `/health` | `200 Healthy` si SQLite responde; `503` si falla |

Swagger está habilitado solo en `Development`: abre `http://localhost:5080/swagger`. Las peticiones de ejemplo están en `BackEnd/FarmBovi.Api.http`.

La lista inicial devuelve todos los registros porque es un módulo de arranque. Para crecer incorpora filtros, paginación y autorización. El `DELETE` actual elimina físicamente el bovino; si después registras vacunas o movimientos relacionados, define un archivado y reglas para conservar el historial.

## Datos de entrada

POST y PUT reciben el mismo cuerpo:

```json
{
  "earTag": "MX-001",
  "name": "Luna",
  "breed": "Holstein",
  "sex": "Hembra",
  "birthDate": "2024-03-15"
}
```

| Campo | Regla |
| --- | --- |
| `earTag` | Obligatorio, de 1 a 40 letras ASCII, números o guiones; comienza con letra o número |
| `name` | Opcional, hasta 80 caracteres; omitirlo conserva la cadena vacía del DTO |
| `breed` | Obligatorio, hasta 80 caracteres |
| `sex` | `Hembra` o `Macho`, respetando mayúsculas; si se omite usa `Hembra` |
| `birthDate` | Opcional: `null` o fecha `YYYY-MM-DD`; no puede ser futura según la fecha UTC del servidor |

El arete se normaliza a mayúsculas antes de guardarse. `mx-001` y `MX-001` representan el mismo identificador. El índice único de SQLite evita duplicados incluso si dos peticiones coinciden.

Ejemplo de respuesta:

```json
{
  "id": 1,
  "earTag": "MX-001",
  "name": "Luna",
  "breed": "Holstein",
  "sex": "Hembra",
  "birthDate": "2024-03-15",
  "createdAt": "2026-10-08T18:00:00Z"
}
```

`id` y `createdAt` los genera el servidor. La fecha de nacimiento usa `DateOnly`, sin hora ni zona horaria. La fecha de creación se devuelve en UTC. PUT reemplaza los campos editables; no es una actualización parcial.

## Errores

Los errores de entrada devuelven `400` con `ValidationProblemDetails`, incluyendo un diccionario `errors`. Un arete duplicado devuelve `409`:

```json
{
  "title": "Arete duplicado",
  "status": 409,
  "detail": "Ya existe un bovino con este arete. Usa un identificador diferente."
}
```

El navegador muestra los mensajes de validación y conflicto. Si ocurre un fallo interno, la API usa un error estándar y registra los detalles en el servidor.

## SQLite local

Ruta predeterminada: `BackEnd/App_Data/farmbovi.db`. La API la resuelve desde su carpeta de contenido para que `dotnet run --project BackEnd` funcione desde la raíz. La base y sus archivos auxiliares están excluidos de Git.

Los registros sobreviven al reinicio de la API. La copia del navegador no sustituye esta persistencia. Para comenzar desde cero en desarrollo, detén la API y elimina la base local; en el siguiente inicio se reconstruye con las migraciones. Esto elimina permanentemente tus registros locales.

SQLite es una elección de arranque para un proceso con disco persistente. Para múltiples réplicas o mayor concurrencia conviene elegir una base de servidor, como PostgreSQL o SQL Server, y generar migraciones adecuadas a ese proveedor.

## Migraciones

Una migración es código C# que describe un cambio de tablas. Se sube a Git para que otra computadora pueda crear el mismo esquema. La migración inicial está incluida; no necesitas generarla otra vez.

El proyecto evita `EnsureCreated` porque esa técnica no evoluciona el esquema con migraciones. Durante desarrollo, `Program.cs` aplica `MigrateAsync` al iniciar. En producción debes aplicar las migraciones explícitamente.

Para añadir una propiedad o entidad:

1. Edita `Models` y la configuración de `FarmDbContext`.
2. Ajusta los DTOs y la interfaz si cambió el contrato.
3. Desde la raíz, ejecuta:

```bash
dotnet tool restore
dotnet ef migrations add NombreDescriptivo --project BackEnd --startup-project BackEnd --output-dir Migrations
dotnet ef database update --project BackEnd --startup-project BackEnd
```

4. Revisa `Up`, `Down` y el snapshot generado antes de subirlos a Git.

Consulta las migraciones:

```bash
dotnet ef migrations list --project BackEnd --startup-project BackEnd
```

Para una base de producción, detén escrituras y respalda la base; luego aplica al archivo persistente previsto:

```bash
export ASPNETCORE_ENVIRONMENT=Production
export ConnectionStrings__FarmBovi='Data Source=/ruta/persistente/farmbovi.db'
dotnet ef database update --project BackEnd --startup-project BackEnd
```

La carpeta de destino debe existir. No mezcles migraciones de distintos proveedores. Microsoft documenta los procedimientos en [Aplicar migraciones de EF Core](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying).

## Cambiar dependencias

Mantén todos los paquetes `Microsoft.EntityFrameworkCore.*` y `dotnet-ef` en la rama 8 y, preferiblemente, en el mismo parche. Después de cambiarlos ejecuta `dotnet restore --force-evaluate FarmBovi.sln` y sube `BackEnd/packages.lock.json`. CI usa `--locked-mode` para detectar cambios sin actualizar el lockfile.
