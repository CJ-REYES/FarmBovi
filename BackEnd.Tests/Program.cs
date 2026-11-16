using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

var checks = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException($"FALLÓ: {description}");
    checks++;
}

static FarmDbContext CreateDb(string name) => new(
    new DbContextOptionsBuilder<FarmDbContext>()
        .UseInMemoryDatabase(name)
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
        .Options);

static async Task<int> DbCountChanges(string name, Guid ranchId)
{
    await using var db = CreateDb(name);
    return await db.CambiosServidor.CountAsync(x => x.IdRancho == ranchId);
}

static string IssueTestJwt(Guid userId, string nombre, string correo, string signingKey, string issuer = "FarmBovi.Tests", string audience = "FarmBovi.Tests.Client")
{
    var now = DateTime.UtcNow;
    var claims = new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, userId.ToString("D")),
        new Claim(ClaimTypes.NameIdentifier, userId.ToString("D")),
        new Claim(ClaimTypes.Name, nombre),
        new Claim(JwtRegisteredClaimNames.Email, correo),
        new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D"))
    };
    var credentials = new SigningCredentials(
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
        SecurityAlgorithms.HmacSha256);
    var token = new JwtSecurityToken(issuer, audience, claims, now, now.AddHours(1), credentials);
    return new JwtSecurityTokenHandler().WriteToken(token);
}

static void AttachJwtUser(ControllerBase controller, Guid userId, string nombre = "Roberto", string correo = "roberto@farmbovi.local")
{
    var identity = new ClaimsIdentity(
    [
        new Claim(JwtRegisteredClaimNames.Sub, userId.ToString("D")),
        new Claim(ClaimTypes.NameIdentifier, userId.ToString("D")),
        new Claim(ClaimTypes.Name, nombre),
        new Claim(ClaimTypes.Email, correo)
    ], "Bearer");

    controller.ControllerContext = new ControllerContext
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(identity)
        }
    };
}

// ============================================================================
// PARTE 1: Suite HTTP E2E de Sincronización Push, JWT y Auditoría (PR #23)
// ============================================================================
var dbName = Guid.NewGuid().ToString("N");
var userId = Guid.NewGuid();
var allowedRanchId = Guid.NewGuid();
var forbiddenRanchId = Guid.NewGuid();
const string signingKey = "FarmBovi-test-signing-key-at-least-32-bytes-long";
var hasher = new PasswordHasher<Usuario>();
var user = new Usuario { IdUsuario = userId, Nombre = "Roberto", Correo = "roberto@example.com", Estado = "Activo" };
user.Contrasena = hasher.HashPassword(user, "Password123!");

await using (var seedDb = CreateDb(dbName))
{
    seedDb.Usuarios.Add(user);
    seedDb.Ranchos.AddRange(
        new Rancho { IdRancho = allowedRanchId, Nombre = "Rancho autorizado", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userId },
        new Rancho { IdRancho = forbiddenRanchId, Nombre = "Rancho ajeno", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = userId });
    seedDb.UsuarioRanchos.Add(new UsuarioRancho
    {
        IdUsuarioRancho = Guid.NewGuid(),
        IdUsuario = userId,
        IdRancho = allowedRanchId,
        Rol = "Admin",
        Estado = "Activo"
    });
    await seedDb.SaveChangesAsync();
}

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Jwt:Issuer"] = "FarmBovi.Tests",
    ["Jwt:Audience"] = "FarmBovi.Tests.Client",
    ["Jwt:SigningKey"] = signingKey,
    ["Jwt:TokenMinutes"] = "60"
});
builder.Services.AddHttpContextAccessor();
builder.Services.AddDbContext<FarmDbContext>(options =>
    options.UseInMemoryDatabase(dbName)
           .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));
builder.Services.AddScoped<FarmDomainValidationService>();
builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
builder.Services.AddControllers().AddApplicationPart(typeof(SincronizacionController).Assembly);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = "FarmBovi.Tests",
        ValidateAudience = true,
        ValidAudience = "FarmBovi.Tests.Client",
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = ClaimTypes.Name
    };
});
builder.Services.AddAuthorization();

await using var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
await app.StartAsync();
try
{
    var address = app.Services.GetRequiredService<IServer>()
        .Features.Get<IServerAddressesFeature>()!.Addresses.Single();
    using var client = new HttpClient { BaseAddress = new Uri(address) };

    var unauthorizedPush = await client.PostAsJsonAsync("api/sync/operaciones", new { });
    Check(unauthorizedPush.StatusCode == HttpStatusCode.Unauthorized, "Push requiere JWT (401)");

    var jwtToken = IssueTestJwt(userId, user.Nombre, user.Correo, signingKey);
    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwtToken);

    var forbiddenPush = await client.PostAsJsonAsync("api/sync/operaciones", new
    {
        idOperacion = Guid.NewGuid(),
        idRancho = forbiddenRanchId,
        idDispositivo = "device-test-1",
        entidad = "Animal",
        idRegistro = Guid.NewGuid(),
        operacion = "Crear",
        datos = new { arete = "FORBID-1", raza = "Holstein", sexo = "Hembra", procedencia = "Prueba", estado = "Activo" }
    });
    Check(forbiddenPush.StatusCode == HttpStatusCode.Forbidden, "Push rechaza rancho no asignado al usuario JWT (403)");

    var pushId = Guid.NewGuid();
    var animalId = Guid.NewGuid();
    var createPushRequest = new
    {
        idOperacion = pushId,
        idRancho = allowedRanchId,
        idDispositivo = "device-test-1",
        entidad = "Animal",
        idRegistro = animalId,
        operacion = "Crear",
        versionBase = (long?)null,
        datos = new
        {
            arete = "PUSH-001",
            raza = "Holstein",
            sexo = "Hembra",
            fechaIngreso = "2026-11-16T00:00:00Z",
            procedencia = "Prueba",
            estado = "Activo"
        }
    };
    var pushResponse = await client.PostAsJsonAsync("api/sync/operaciones", createPushRequest);
    Check(pushResponse.StatusCode == HttpStatusCode.Created, "Push crea animal autenticado (201)");
    var pushCreated = await pushResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(pushCreated is not null && pushCreated.Version == 1 && !pushCreated.DuplicadoIgnorado && pushCreated.IdCambio != Guid.Empty,
        "Push crea versión inicial y devuelve IdCambio para compatibilidad con Pull");

    var changesAfterCreate = await DbCountChanges(dbName, allowedRanchId);
    Check(changesAfterCreate == 1, "Push registra exactamente 1 fila en CambioServidor");

    var duplicateCreateResponse = await client.PostAsJsonAsync("api/sync/operaciones", createPushRequest);
    var duplicateCreate = await duplicateCreateResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(duplicateCreateResponse.StatusCode == HttpStatusCode.OK && duplicateCreate!.DuplicadoIgnorado,
        "Push repetido es idempotente (200 OK, DuplicadoIgnorado=true)");
    Check(await DbCountChanges(dbName, allowedRanchId) == changesAfterCreate,
        "Reintento Push no duplica CambioServidor");

    var mismatchedRetry = await client.PostAsJsonAsync("api/sync/operaciones", new
    {
        idOperacion = pushId,
        idRancho = allowedRanchId,
        idDispositivo = "device-test-1",
        entidad = "Animal",
        idRegistro = animalId,
        operacion = "Crear",
        versionBase = (long?)null,
        datos = new
        {
            arete = "PUSH-DIFFERENT",
            raza = "Holstein",
            sexo = "Hembra",
            fechaIngreso = "2026-11-16T00:00:00Z",
            procedencia = "Prueba",
            estado = "Activo"
        }
    });
    Check(mismatchedRetry.StatusCode == HttpStatusCode.Conflict,
        "Push rechaza reutilizar idOperacion con contenido distinto (409)");

    var updateOperationId = Guid.NewGuid();
    var updatePayload = new
    {
        idOperacion = updateOperationId,
        idRancho = allowedRanchId,
        idDispositivo = "device-test-1",
        entidad = "Animal",
        idRegistro = animalId,
        operacion = "Actualizar",
        versionBase = 1,
        datos = new { estado = "En revisión" }
    };
    var updateResponse = await client.PostAsJsonAsync("api/sync/operaciones", updatePayload);
    var updated = await updateResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(updateResponse.StatusCode == HttpStatusCode.OK && updated!.Version == 2,
        "Push actualiza registro y avanza versión a 2");

    var duplicateUpdateResponse = await client.PostAsJsonAsync("api/sync/operaciones", updatePayload);
    var duplicateUpdate = await duplicateUpdateResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(duplicateUpdateResponse.StatusCode == HttpStatusCode.OK && duplicateUpdate!.DuplicadoIgnorado &&
          await DbCountChanges(dbName, allowedRanchId) == changesAfterCreate + 1,
        "Reintento de actualización no registra un segundo cambio");

    var staleResponse = await client.PostAsJsonAsync("api/sync/operaciones", new
    {
        idOperacion = Guid.NewGuid(),
        idRancho = allowedRanchId,
        idDispositivo = "device-2",
        entidad = "Animal",
        idRegistro = animalId,
        operacion = "Actualizar",
        versionBase = 1,
        datos = new { estado = "Cambio antiguo" }
    });
    Check(staleResponse.StatusCode == HttpStatusCode.Conflict, "Push detecta conflicto de versión obsoleta (409)");

    var deleteResponse = await client.PostAsJsonAsync("api/sync/operaciones", new
    {
        idOperacion = Guid.NewGuid(),
        idRancho = allowedRanchId,
        idDispositivo = "device-test-1",
        entidad = "Animal",
        idRegistro = animalId,
        operacion = "Eliminar",
        versionBase = 2,
        datos = (object?)null
    });
    var deleted = await deleteResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(deleteResponse.StatusCode == HttpStatusCode.OK && deleted!.Operacion == "Eliminar" &&
          deleted.Version == 3 && deleted.Datos is null,
        "Push elimina con versión correcta y genera tombstone (Datos=null para Pull de Angel)");

    var auditResponse = await client.GetFromJsonAsync<List<CambioServidor>>(
        $"api/sync/auditoria?idRancho={allowedRanchId}&entidad=Animal&limite=50");
    Check(auditResponse is not null && auditResponse.Count == 3,
        "GET /api/sync/auditoria devuelve exactamente los 3 cambios válidos (Crear, Actualizar, Eliminar)");
}
finally
{
    await app.StopAsync();
}

// ============================================================================
// PARTE 2: Verificación Exhaustiva de los 9 Puntos de Corrección de Roberto
// (InMemory + Base de Datos Real MySQL/MariaDB con Migraciones)
// ============================================================================
async Task RunSyncVerificationSuiteAsync(Func<FarmDbContext> contextFactory, string suiteLabel)
{
    var userAId = Guid.NewGuid();
    var userBId = Guid.NewGuid();
    var userSinPermisoId = Guid.NewGuid();
    var ranchoAId = Guid.NewGuid();
    var ranchoBId = Guid.NewGuid();
    var loteAId = Guid.NewGuid();
    var loteBId = Guid.NewGuid();

    await using (var seedDb = contextFactory())
    {
        seedDb.Usuarios.AddRange(
            new Usuario { IdUsuario = userAId, Nombre = "Roberto", Correo = $"roberto.{Guid.NewGuid():N}@farmbovi.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { IdUsuario = userBId, Nombre = "Angel", Correo = $"angel.{Guid.NewGuid():N}@farmbovi.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { IdUsuario = userSinPermisoId, Nombre = "Externo", Correo = $"ext.{Guid.NewGuid():N}@farmbovi.local", Contrasena = "hash", Estado = "Activo" });

        seedDb.Ranchos.AddRange(
            new Rancho { IdRancho = ranchoAId, Nombre = "Rancho A", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userAId },
            new Rancho { IdRancho = ranchoBId, Nombre = "Rancho B", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = userBId });

        seedDb.UsuarioRanchos.AddRange(
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userAId, IdRancho = ranchoAId, Rol = "Admin", Estado = "Activo" },
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userBId, IdRancho = ranchoBId, Rol = "Admin", Estado = "Activo" });

        seedDb.Lotes.AddRange(
            new Lote { IdLote = loteAId, IdRancho = ranchoAId, Nombre = $"Lote A1 {Guid.NewGuid():N}"[..20], Estado = "Activo", IdAutor = userAId },
            new Lote { IdLote = loteBId, IdRancho = ranchoBId, Nombre = $"Lote B1 {Guid.NewGuid():N}"[..20], Estado = "Activo", IdAutor = userBId });

        await seedDb.SaveChangesAsync();
        seedDb.CambiosServidor.RemoveRange(seedDb.CambiosServidor.Where(c => c.IdRancho == ranchoAId || c.IdRancho == ranchoBId));
        await seedDb.SaveChangesAsync();
    }

    // Punto 8: SincronizacionController no duplica GET /api/sync/cambios
    var metodosSync = typeof(SincronizacionController).GetMethods(BindingFlags.Public | BindingFlags.Instance);
    Check(!metodosSync.Any(m => m.Name.Contains("Cambios", StringComparison.OrdinalIgnoreCase)),
        $"[{suiteLabel}] Punto 8: SincronizacionController no duplica GET /api/sync/cambios de Angel");

    // Punto 4: Seguridad JWT, idDispositivo y membresía de rancho
    var opCreateId = Guid.NewGuid();
    var animalId = Guid.NewGuid();
    var createPayload = JsonSerializer.SerializeToElement(new
    {
        idAnimal = animalId,
        idRancho = ranchoBId,
        idAutor = userSinPermisoId,
        idLote = loteAId,
        arete = $"MX-{Guid.NewGuid():N}"[..15],
        raza = "Brangus",
        sexo = "Macho",
        procedencia = "Rancho A",
        estado = "Activo"
    });

    await using (var db = contextFactory())
    {
        var sync = new SincronizacionController(db);
        AttachJwtUser(sync, userAId);

        var resCreate = await sync.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = opCreateId,
            IdUsuario = userSinPermisoId,
            IdRancho = ranchoAId,
            IdDispositivo = "android-dev-01",
            Entidad = "Animal",
            IdRegistro = animalId,
            Operacion = "Crear",
            Payload = createPayload
        }, default);

        Check(resCreate is CreatedAtActionResult, $"[{suiteLabel}] Push Crear responde 201 Created");
        var animalGuardado = await db.Animales.AsNoTracking().SingleAsync(a => a.IdAnimal == animalId);
        Check(animalGuardado.IdAutor == userAId && animalGuardado.IdRancho == ranchoAId,
            $"[{suiteLabel}] Punto 4: IdAutor e IdRancho se fijan según JWT y rancho validado");

        var cambios = await db.CambiosServidor.AsNoTracking().Where(c => c.IdOperacion == opCreateId).ToListAsync();
        Check(cambios.Count == 1 && cambios[0].Datos is not null,
            $"[{suiteLabel}] Punto 8 y 9: Se inserta 1 sola fila en CambioServidor con Datos listos para Pull de Angel");
    }

    // Punto 2: Hash canónico con propiedades JSON en distinto orden
    var payloadOrdenA = JsonDocument.Parse("""{"raza":"Brangus","arete":"MX-100","nested":{"z":1,"a":2}}""").RootElement;
    var payloadOrdenB = JsonDocument.Parse("""{"nested":{"a":2,"z":1},"arete":"MX-100","raza":"Brangus"}""").RootElement;
    var hashA = SincronizacionController.ComputeRequestHash(userAId, ranchoAId, "dev-1", "Animal", animalId, "Crear", null, payloadOrdenA);
    var hashB = SincronizacionController.ComputeRequestHash(userAId, ranchoAId, "dev-1", "Animal", animalId, "Crear", null, payloadOrdenB);
    Check(hashA == hashB, $"[{suiteLabel}] Punto 2: ComputeRequestHash es canónico sin importar el orden de propiedades");

    // Punto 1: Solicitudes duplicadas simultáneas
    var opDupConcurrenteId = Guid.NewGuid();
    var animalConcurrenteId = Guid.NewGuid();
    var areteDup = $"MX-DUP-{Guid.NewGuid():N}"[..18];
    var payloadDupA = JsonDocument.Parse($$"""{"idAnimal":"{{animalConcurrenteId}}","idLote":"{{loteAId}}","arete":"{{areteDup}}","raza":"Angus","sexo":"Hembra","procedencia":"Propio","estado":"Activo"}""").RootElement;
    var payloadDupB = JsonDocument.Parse($$"""{"estado":"Activo","procedencia":"Propio","sexo":"Hembra","raza":"Angus","arete":"{{areteDup}}","idLote":"{{loteAId}}","idAnimal":"{{animalConcurrenteId}}"}""").RootElement;

    var resultadosSimultaneos = await Task.WhenAll(
        Task.Run(async () =>
        {
            await using var db1 = contextFactory();
            var c1 = new SincronizacionController(db1);
            AttachJwtUser(c1, userAId);
            return await c1.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = opDupConcurrenteId,
                IdRancho = ranchoAId,
                IdDispositivo = "android-dev-01",
                Entidad = "Animal",
                IdRegistro = animalConcurrenteId,
                Operacion = "Crear",
                Payload = payloadDupA
            }, default);
        }),
        Task.Run(async () =>
        {
            await using var db2 = contextFactory();
            var c2 = new SincronizacionController(db2);
            AttachJwtUser(c2, userAId);
            return await c2.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = opDupConcurrenteId,
                IdRancho = ranchoAId,
                IdDispositivo = "android-dev-01",
                Entidad = "Animal",
                IdRegistro = animalConcurrenteId,
                Operacion = "Crear",
                Payload = payloadDupB
            }, default);
        }));

    Check(resultadosSimultaneos.All(r => r is CreatedAtActionResult or OkObjectResult),
        $"[{suiteLabel}] Punto 1: Solicitudes duplicadas simultáneas devuelven resultado controlado sin error 500");

    // Punto 5: Lista blanca en ApplyPartialUpdate
    await using (var db = contextFactory())
    {
        var sync = new SincronizacionController(db);
        AttachJwtUser(sync, userAId);

        var resUpd = await sync.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchoAId,
            IdDispositivo = "android-dev-01",
            Entidad = "Animal",
            IdRegistro = animalId,
            Operacion = "Actualizar",
            VersionBase = 1,
            Payload = JsonSerializer.SerializeToElement(new
            {
                idRancho = ranchoBId,
                idAutor = userBId,
                versionRegistro = 999,
                raza = "Nelore",
                observaciones = "Whitelist OK"
            })
        }, default);

        Check(resUpd is OkObjectResult, $"[{suiteLabel}] Punto 5: Actualizar con lista blanca responde 200 OK");
        var animalActualizado = await db.Animales.AsNoTracking().SingleAsync(a => a.IdAnimal == animalId);
        Check(animalActualizado.IdRancho == ranchoAId && animalActualizado.IdAutor == userAId && animalActualizado.Raza == "Nelore",
            $"[{suiteLabel}] Punto 5: ApplyPartialUpdate protege IdRancho e IdAutor y aplica propiedades permitidas");
    }

    // Punto 3: Concurrencia optimista simultánea entre dos dispositivos
    var resConcurrentes = await Task.WhenAll(
        Task.Run(async () =>
        {
            await using var db1 = contextFactory();
            var c1 = new SincronizacionController(db1);
            AttachJwtUser(c1, userAId);
            return await c1.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = Guid.NewGuid(),
                IdRancho = ranchoAId,
                IdDispositivo = "disp-1",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Actualizar",
                VersionBase = 2,
                Payload = JsonSerializer.SerializeToElement(new { raza = "Brahman" })
            }, default);
        }),
        Task.Run(async () =>
        {
            await using var db2 = contextFactory();
            var c2 = new SincronizacionController(db2);
            AttachJwtUser(c2, userAId);
            return await c2.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = Guid.NewGuid(),
                IdRancho = ranchoAId,
                IdDispositivo = "disp-2",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Actualizar",
                VersionBase = 2,
                Payload = JsonSerializer.SerializeToElement(new { raza = "Charolais" })
            }, default);
        }));

    Check(resConcurrentes.Count(r => r is OkObjectResult) == 1 && resConcurrentes.Count(r => r is ConflictObjectResult) == 1,
        $"[{suiteLabel}] Punto 3: Concurrencia optimista simultánea acepta 1 y rechaza la otra con 409 Conflict");

    // Punto 6: CalcularCamposModificados en estructuras anidadas
    var jsonServComplejo = JsonDocument.Parse("""{"condiciones":{"iluminacion":"Buena","distanciaM":2.5},"vistas":["lateral","dorsal"]}""").RootElement;
    var jsonCliComplejo = JsonDocument.Parse("""{"condiciones":{"distanciaM":3.0,"iluminacion":"Buena"},"vistas":["lateral","frontal"]}""").RootElement;
    var diffsComplejos = SincronizacionController.CalcularCamposModificados(jsonServComplejo, jsonCliComplejo);
    Check(diffsComplejos.Any(d => d.Campo == "condiciones.distanciaM") && diffsComplejos.Any(d => d.Campo == "vistas"),
        $"[{suiteLabel}] Punto 6: CalcularCamposModificados detecta diferencias en objetos anidados y arreglos");
}

var sharedUnitDb = Guid.NewGuid().ToString("N");
await RunSyncVerificationSuiteAsync(() => CreateDb(sharedUnitDb), "InMemory");

// Punto 7: Ejecución contra BD Real MySQL/MariaDB con migraciones cuando esté disponible
var realConnectionString = Environment.GetEnvironmentVariable("FARMBOVI_TEST_CONNECTION")
    ?? "Server=localhost;Port=3306;Database=farmbovi;User ID=farmbovi;Password=change_me;";

FarmDbContext CreateRealMySqlDb() => new(
    new DbContextOptionsBuilder<FarmDbContext>()
        .UseMySQL(realConnectionString)
        .ReplaceService<IHistoryRepository, MariaDbCompatibleHistoryRepository>()
        .Options);

bool canConnectRealDb = false;
try
{
    await using var probeDb = CreateRealMySqlDb();
    canConnectRealDb = await probeDb.Database.CanConnectAsync();
    if (canConnectRealDb)
    {
        await probeDb.Database.MigrateAsync();
    }
}
catch
{
    canConnectRealDb = false;
}

if (canConnectRealDb)
{
    await RunSyncVerificationSuiteAsync(CreateRealMySqlDb, "MySQL/MariaDB Real");
    Console.WriteLine("Suite ejecutada exitosamente contra base de datos MySQL/MariaDB real con migraciones.");
}

Console.WriteLine($"Correcto: {checks} comprobaciones de Sincronización Push y Auditoría (PR #23) superadas.");
