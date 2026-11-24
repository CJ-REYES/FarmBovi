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
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace FarmBovi.Tests;

public sealed class SyncPushAndAuditTests
{
    private static FarmDbContext CreateInMemoryDb(string dbName) => new(
        new DbContextOptionsBuilder<FarmDbContext>()
            .UseInMemoryDatabase(dbName)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options);

    private static SincronizacionController CreateSyncController(FarmDbContext db) =>
        new(db, new RanchAccessService(db));

    private static void AttachJwtUser(
        ControllerBase controller,
        int userId,
        string nombre = "Roberto",
        string correo = "roberto@farmbovi.local",
        string? deviceClaim = null,
        string? deviceHeader = null)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(ClaimTypes.NameIdentifier, userId.ToString()),
            new(ClaimTypes.Name, nombre),
            new(ClaimTypes.Email, correo)
        };
        if (!string.IsNullOrWhiteSpace(deviceClaim))
            claims.Add(new Claim("device_id", deviceClaim));

        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer"))
        };
        if (!string.IsNullOrWhiteSpace(deviceHeader))
            httpContext.Request.Headers["X-Device-Id"] = deviceHeader;

        controller.ControllerContext = new ControllerContext { HttpContext = httpContext };
    }

    private static string IssueTestJwt(int userId, string nombre, string correo, string signingKey)
    {
        var now = DateTime.UtcNow;
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Name, nombre),
            new Claim(JwtRegisteredClaimNames.Email, correo),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D"))
        };
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken("FarmBovi.Tests", "FarmBovi.Tests.Client", claims, now, now.AddHours(1), credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static async Task<(int UserA, int UserB, int UserSinPermiso, Guid RanchoA, Guid RanchoB, Guid LoteA)> SeedAsync(
        Func<FarmDbContext> factory)
    {
        const int userA = 1;
        const int userB = 2;
        const int userSinPermiso = 3;
        var ranchoA = Guid.NewGuid();
        var ranchoB = Guid.NewGuid();
        var loteA = Guid.NewGuid();

        await using var db = factory();
        db.Usuarios.AddRange(
            new Usuario { Id = userA, Nombre = "Roberto", Correo = $"roberto.{Guid.NewGuid():N}@farmbovi.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { Id = userB, Nombre = "Angel", Correo = $"angel.{Guid.NewGuid():N}@farmbovi.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { Id = userSinPermiso, Nombre = "Externo", Correo = $"ext.{Guid.NewGuid():N}@farmbovi.local", Contrasena = "hash", Estado = "Activo" });

        db.Ranchos.AddRange(
            new Rancho { IdRancho = ranchoA, Nombre = "Rancho A", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userA },
            new Rancho { IdRancho = ranchoB, Nombre = "Rancho B", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = userB });

        db.UsuarioRanchos.AddRange(
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userA, IdRancho = ranchoA, Rol = "Admin", Estado = "Activo" },
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userB, IdRancho = ranchoB, Rol = "Admin", Estado = "Activo" });

        db.Lotes.Add(new Lote { IdLote = loteA, IdRancho = ranchoA, Nombre = "Lote A1", Estado = "Activo", IdAutor = userA });
        await db.SaveChangesAsync();

        db.CambiosServidor.RemoveRange(db.CambiosServidor);
        await db.SaveChangesAsync();

        return (userA, userB, userSinPermiso, ranchoA, ranchoB, loteA);
    }

    [Fact]
    public void SincronizacionController_NoDuplicaEndpointPullDeAngel()
    {
        var methods = typeof(SincronizacionController).GetMethods(BindingFlags.Public | BindingFlags.Instance);
        Assert.DoesNotContain(methods, m => m.Name.Contains("Cambios", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task RecibirOperacion_SinJwt_Retorna401Unauthorized()
    {
        var dbName = Guid.NewGuid().ToString("N");
        await using var db = CreateInMemoryDb(dbName);
        var controller = CreateSyncController(db);
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };

        var result = await controller.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = Guid.NewGuid(),
            IdDispositivo = "android-01",
            Entidad = "Animal",
            Operacion = "Crear",
            Payload = JsonSerializer.SerializeToElement(new { arete = "MX-1" })
        }, default);

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task RecibirOperacion_UsuarioSinMembresiaEnRancho_Retorna403Forbidden()
    {
        var dbName = Guid.NewGuid().ToString("N");
        var (_, _, userSinPermiso, ranchoA, _, _) = await SeedAsync(() => CreateInMemoryDb(dbName));

        await using var db = CreateInMemoryDb(dbName);
        var controller = CreateSyncController(db);
        AttachJwtUser(controller, userSinPermiso);

        var result = await controller.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchoA,
            IdDispositivo = "android-ext",
            Entidad = "Animal",
            Operacion = "Crear",
            Payload = JsonSerializer.SerializeToElement(new { arete = "MX-FORBID" })
        }, default);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task RecibirOperacion_ValidacionDeDispositivo_RechazaVacioYClaimMismatch()
    {
        var dbName = Guid.NewGuid().ToString("N");
        var (userA, _, _, ranchoA, _, _) = await SeedAsync(() => CreateInMemoryDb(dbName));

        await using var db = CreateInMemoryDb(dbName);
        var controller = CreateSyncController(db);

        AttachJwtUser(controller, userA);
        var emptyDevice = await controller.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchoA,
            IdDispositivo = "  ",
            Entidad = "Animal",
            Operacion = "Crear",
            Payload = JsonSerializer.SerializeToElement(new { arete = "MX-1" })
        }, default);
        Assert.IsType<BadRequestObjectResult>(emptyDevice);

        AttachJwtUser(controller, userA, deviceClaim: "device-autorizado");
        var mismatchClaim = await controller.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchoA,
            IdDispositivo = "device-suplantado",
            Entidad = "Animal",
            Operacion = "Crear",
            Payload = JsonSerializer.SerializeToElement(new { arete = "MX-2" })
        }, default);
        var forbidden = Assert.IsType<ObjectResult>(mismatchClaim);
        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
    }

    [Fact]
    public async Task Idempotencia_DosContextosIndependientes_MismoIdOperacion_NoDuplicaNiFalla()
    {
        var dbName = Guid.NewGuid().ToString("N");
        var (userA, _, _, ranchoA, _, loteA) = await SeedAsync(() => CreateInMemoryDb(dbName));

        var opId = Guid.NewGuid();
        var animalId = Guid.NewGuid();
        var payloadA = JsonDocument.Parse($$"""{"idAnimal":"{{animalId}}","idLote":"{{loteA}}","arete":"MX-CONC-1","raza":"Angus","sexo":"Hembra","procedencia":"Propio","estado":"Activo"}""").RootElement;
        var payloadB = JsonDocument.Parse($$"""{"estado":"Activo","procedencia":"Propio","sexo":"Hembra","raza":"Angus","arete":"MX-CONC-1","idLote":"{{loteA}}","idAnimal":"{{animalId}}"}""").RootElement;

        IActionResult res1;
        await using (var db1 = CreateInMemoryDb(dbName))
        {
            var c1 = CreateSyncController(db1);
            AttachJwtUser(c1, userA);
            res1 = await c1.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = opId,
                IdRancho = ranchoA,
                IdDispositivo = "android-dev-01",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Crear",
                Payload = payloadA
            }, default);
        }

        IActionResult res2;
        await using (var db2 = CreateInMemoryDb(dbName))
        {
            var c2 = CreateSyncController(db2);
            AttachJwtUser(c2, userA);
            res2 = await c2.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = opId,
                IdRancho = ranchoA,
                IdDispositivo = "android-dev-01",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Crear",
                Payload = payloadB
            }, default);
        }

        Assert.IsType<CreatedAtActionResult>(res1);
        var ok2 = Assert.IsType<OkObjectResult>(res2);
        var dto2 = Assert.IsType<OperacionSyncResponse>(ok2.Value);
        Assert.True(dto2.DuplicadoIgnorado);

        await using var checkDb = CreateInMemoryDb(dbName);
        Assert.Equal(1, await checkDb.CambiosServidor.CountAsync(c => c.IdOperacion == opId));
        Assert.Equal(1, await checkDb.RegistrosSyncServidor.CountAsync(r => r.IdOperacion == opId));
    }

    [Fact]
    public void ComputeRequestHash_CanonicoEIncluyeIdentidadCompleta()
    {
        const int userA = 1;
        const int userB = 2;
        var ranchoA = Guid.NewGuid();
        var regId = Guid.NewGuid();

        var jsonA = JsonDocument.Parse("""{"raza":"Brangus","arete":"MX-1","nested":{"z":1,"a":2}}""").RootElement;
        var jsonB = JsonDocument.Parse("""{"nested":{"a":2,"z":1},"arete":"MX-1","raza":"Brangus"}""").RootElement;

        var h1 = SincronizacionController.ComputeRequestHash(userA, ranchoA, "dev-1", "Animal", regId, "Crear", null, jsonA);
        var h2 = SincronizacionController.ComputeRequestHash(userA, ranchoA, "dev-1", "Animal", regId, "Crear", null, jsonB);
        var hOtherDevice = SincronizacionController.ComputeRequestHash(userA, ranchoA, "dev-2", "Animal", regId, "Crear", null, jsonA);
        var hOtherUser = SincronizacionController.ComputeRequestHash(userB, ranchoA, "dev-1", "Animal", regId, "Crear", null, jsonA);

        Assert.Equal(h1, h2);
        Assert.NotEqual(h1, hOtherDevice);
        Assert.NotEqual(h1, hOtherUser);
    }

    [Fact]
    public async Task ConflictoVersion_UsaHistorialCambioServidorDesdeVersionBaseYListaBlanca()
    {
        var dbName = Guid.NewGuid().ToString("N");
        var (userA, userB, _, ranchoA, ranchoB, loteA) = await SeedAsync(() => CreateInMemoryDb(dbName));

        var animalId = Guid.NewGuid();
        await using (var db = CreateInMemoryDb(dbName))
        {
            var sync = CreateSyncController(db);
            AttachJwtUser(sync, userA);

            var created = await sync.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = Guid.NewGuid(),
                IdRancho = ranchoA,
                IdDispositivo = "dev-1",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Crear",
                Payload = JsonSerializer.SerializeToElement(new
                {
                    idAnimal = animalId,
                    idRancho = ranchoB,
                    idLote = loteA,
                    arete = "MX-HIST-01",
                    raza = "Brangus",
                    sexo = "Macho",
                    procedencia = "Propio",
                    estado = "Activo"
                })
            }, default);
            Assert.IsType<CreatedAtActionResult>(created);

            var updated = await sync.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = Guid.NewGuid(),
                IdRancho = ranchoA,
                IdDispositivo = "dev-1",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Actualizar",
                VersionBase = 1,
                Payload = JsonSerializer.SerializeToElement(new
                {
                    idRancho = ranchoB,
                    idAutor = userB,
                    versionRegistro = 999,
                    raza = "Nelore",
                    estado = "Cuarentena"
                })
            }, default);
            Assert.IsType<OkObjectResult>(updated);
        }

        await using (var db = CreateInMemoryDb(dbName))
        {
            var animalActual = await db.Animales.AsNoTracking().SingleAsync(a => a.IdAnimal == animalId);
            Assert.Equal(ranchoA, animalActual.IdRancho);
            Assert.Equal(userA, animalActual.IdAutor);
            Assert.Equal(2, animalActual.VersionRegistro);

            var sync = CreateSyncController(db);
            AttachJwtUser(sync, userA);

            var conflict = await sync.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = Guid.NewGuid(),
                IdRancho = ranchoA,
                IdDispositivo = "dev-2",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Actualizar",
                VersionBase = 1,
                Payload = JsonSerializer.SerializeToElement(new { observaciones = "Nota parcial" })
            }, default);

            var conflictResult = Assert.IsType<ConflictObjectResult>(conflict);
            var dto = Assert.IsType<ConflictoSyncResponse>(conflictResult.Value);
            Assert.Equal("VERSION_MISMATCH", dto.TipoConflicto);
            Assert.Equal(2, dto.VersionServidor);
            Assert.NotNull(dto.EstadoServidor);
            Assert.Contains(dto.CamposModificados, c => c.Campo.Equals("raza", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(dto.CamposModificados, c => c.Campo.Equals("estado", StringComparison.OrdinalIgnoreCase));
        }

        await using (var db = CreateInMemoryDb(dbName))
        {
            var syncB = CreateSyncController(db);
            AttachJwtUser(syncB, userB);

            var crossRanch = await syncB.RecibirOperacion(new OperacionSyncRequest
            {
                IdOperacion = Guid.NewGuid(),
                IdRancho = ranchoB,
                IdDispositivo = "dev-b",
                Entidad = "Animal",
                IdRegistro = animalId,
                Operacion = "Actualizar",
                VersionBase = 2,
                Payload = JsonSerializer.SerializeToElement(new { raza = "Intruso" })
            }, default);

            var forbidden = Assert.IsType<ObjectResult>(crossRanch);
            Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
        }
    }

    [Fact]
    public void CalcularCamposModificados_DetectaCambiosEnEstructurasAnidadasYArreglos()
    {
        var server = JsonDocument.Parse("""{"condiciones":{"iluminacion":"Buena","distanciaM":2.5},"vistas":["lateral","dorsal"]}""").RootElement;
        var client = JsonDocument.Parse("""{"condiciones":{"distanciaM":3.0,"iluminacion":"Buena"},"vistas":["lateral","frontal"]}""").RootElement;

        var diffs = SincronizacionController.CalcularCamposModificados(server, client);

        Assert.Contains(diffs, d => d.Campo == "condiciones.distanciaM");
        Assert.Contains(diffs, d => d.Campo == "vistas");
        Assert.DoesNotContain(diffs, d => d.Campo == "condiciones.iluminacion");
    }

    [Fact]
    public async Task SaveChangesSincronoYAsincrono_AuditaRanchoYEntidadesSinOmitirCambios()
    {
        var dbName = Guid.NewGuid().ToString("N");
        const int userId = 10;
        var ranchoId = Guid.NewGuid();

        await using (var db = CreateInMemoryDb(dbName))
        {
            db.Usuarios.Add(new Usuario
            {
                Id = userId,
                Nombre = "Roberto",
                Correo = "rob@farmbovi.local",
                Contrasena = "hash",
                Estado = "Activo"
            });
            db.SaveChanges();

            db.Ranchos.Add(new Rancho
            {
                IdRancho = ranchoId,
                Nombre = "Rancho Sync",
                UbicacionGeneral = "Norte",
                Estado = "Activo",
                IdAutor = userId
            });
            db.SaveChanges();
        }

        await using (var checkDb = CreateInMemoryDb(dbName))
        {
            var cambioRancho = await checkDb.CambiosServidor.SingleOrDefaultAsync(c => c.Entidad == nameof(Rancho) && c.IdRegistro == ranchoId);
            Assert.NotNull(cambioRancho);
            Assert.Equal("Crear", cambioRancho!.Operacion);
            Assert.Equal("API", cambioRancho.Origen);
        }
    }

    [Fact]
    public async Task HttpPipelineE2E_ValidaJwtPushIdempotenciaYAuditoria()
    {
        var dbName = Guid.NewGuid().ToString("N");
        const int userId = 11;
        var ranchoId = Guid.NewGuid();
        const string signingKey = "FarmBovi-test-signing-key-at-least-32-bytes-long";

        await using (var seedDb = CreateInMemoryDb(dbName))
        {
            seedDb.Usuarios.Add(new Usuario { Id = userId, Nombre = "Roberto", Correo = "rob@test.local", Contrasena = "hash", Estado = "Activo" });
            seedDb.Ranchos.Add(new Rancho { IdRancho = ranchoId, Nombre = "Rancho HTTP", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userId });
            seedDb.UsuarioRanchos.Add(new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userId, IdRancho = ranchoId, Rol = "Admin", Estado = "Activo" });
            await seedDb.SaveChangesAsync();
            seedDb.CambiosServidor.RemoveRange(seedDb.CambiosServidor);
            await seedDb.SaveChangesAsync();
        }

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddDbContext<FarmDbContext>(o =>
            o.UseInMemoryDatabase(dbName).ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));
        builder.Services.AddScoped<FarmDomainValidationService>();
        builder.Services.AddScoped<RanchAccessService>();
        builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
        builder.Services.AddControllers().AddApplicationPart(typeof(SincronizacionController).Assembly);
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
        {
            o.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = "FarmBovi.Tests",
                ValidateAudience = true,
                ValidAudience = "FarmBovi.Tests.Client",
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(30)
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
            var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address) };

            var unauth = await client.PostAsJsonAsync("api/sync/operaciones", new { });
            Assert.Equal(HttpStatusCode.Unauthorized, unauth.StatusCode);

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
                "Bearer", IssueTestJwt(userId, "Roberto", "rob@test.local", signingKey));

            var opId = Guid.NewGuid();
            var animalId = Guid.NewGuid();
            var req = new
            {
                idOperacion = opId,
                idRancho = ranchoId,
                idDispositivo = "http-device-1",
                entidad = "Animal",
                idRegistro = animalId,
                operacion = "Crear",
                datos = new { arete = "HTTP-1", raza = "Angus", sexo = "Macho", procedencia = "Propio", estado = "Activo" }
            };

            var res1 = await client.PostAsJsonAsync("api/sync/operaciones", req);
            Assert.Equal(HttpStatusCode.Created, res1.StatusCode);

            var res2 = await client.PostAsJsonAsync("api/sync/operaciones", req);
            Assert.Equal(HttpStatusCode.OK, res2.StatusCode);
            var body2 = await res2.Content.ReadFromJsonAsync<OperacionSyncResponse>();
            Assert.True(body2!.DuplicadoIgnorado);

            var audit = await client.GetFromJsonAsync<List<CambioServidor>>($"api/sync/auditoria?idRancho={ranchoId}&entidad=Animal");
            Assert.NotNull(audit);
            Assert.Single(audit!);
        }
        finally
        {
            await app.StopAsync();
        }
    }
}
