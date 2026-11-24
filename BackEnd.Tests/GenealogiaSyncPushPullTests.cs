using System.Security.Claims;
using System.Text.Json;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FarmBovi.Tests;

public sealed class GenealogiaSyncPushPullTests
{
    private static FarmDbContext CreateDb(string name) => new(
        new DbContextOptionsBuilder<FarmDbContext>()
            .UseInMemoryDatabase(name)
            .Options);

    private static ControllerContext CreateUserContext(Guid userId) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim("sub", userId.ToString())
            ], "Bearer"))
        }
    };

    private static SincronizacionController PushController(FarmDbContext db, Guid userId) => new(db)
    {
        ControllerContext = CreateUserContext(userId)
    };

    private static SyncController PullController(FarmDbContext db, Guid userId) => new(db)
    {
        ControllerContext = CreateUserContext(userId)
    };

    private static CambiosPullResponse OkPull(ActionResult<CambiosPullResponse> action)
    {
        var ok = Assert.IsType<OkObjectResult>(action.Result);
        return Assert.IsType<CambiosPullResponse>(ok.Value);
    }

    private sealed record WorldSeed(
        Guid UserA,
        Guid UserADeviceB,
        Guid UserB,
        Guid RanchA,
        Guid RanchB,
        Guid GrandpaA,
        Guid FatherA,
        Guid MotherA,
        Guid CalfA,
        Guid AnimalB,
        Guid FatherB);

    private static async Task<WorldSeed> SeedWorldAsync(FarmDbContext db)
    {
        var userA = Guid.NewGuid();
        var userADeviceB = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var ranchA = Guid.NewGuid();
        var ranchB = Guid.NewGuid();

        db.Usuarios.AddRange(
            new Usuario { IdUsuario = userA, Nombre = "User A", Correo = $"a-{userA:N}@test.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { IdUsuario = userADeviceB, Nombre = "User A2", Correo = $"a2-{userADeviceB:N}@test.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { IdUsuario = userB, Nombre = "User B", Correo = $"b-{userB:N}@test.local", Contrasena = "hash", Estado = "Activo" });

        db.Ranchos.AddRange(
            new Rancho { IdRancho = ranchA, Nombre = "Rancho A", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userA },
            new Rancho { IdRancho = ranchB, Nombre = "Rancho B", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = userB });

        db.UsuarioRanchos.AddRange(
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userA, IdRancho = ranchA, Rol = "Admin", Estado = "Activo" },
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userADeviceB, IdRancho = ranchA, Rol = "Operador", Estado = "Activo" },
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userB, IdRancho = ranchB, Rol = "Admin", Estado = "Activo" });

        var grandpaA = Guid.NewGuid();
        var fatherA = Guid.NewGuid();
        var motherA = Guid.NewGuid();
        var calfA = Guid.NewGuid();
        var animalB = Guid.NewGuid();
        var fatherB = Guid.NewGuid();

        db.Animales.AddRange(
            new Animal { IdAnimal = grandpaA, IdRancho = ranchA, Arete = "A-ABU", Raza = "Brahman", Sexo = "Macho", FechaNacimiento = new DateTime(2017, 1, 1), FechaIngreso = new DateTime(2017, 1, 1), Procedencia = "Propio", Estado = "Activo", IdAutor = userA },
            new Animal { IdAnimal = fatherA, IdRancho = ranchA, Arete = "A-PAD", Raza = "Brahman", Sexo = "Macho", FechaNacimiento = new DateTime(2020, 1, 1), FechaIngreso = new DateTime(2020, 1, 1), Procedencia = "Propio", Estado = "Activo", IdAutor = userA },
            new Animal { IdAnimal = motherA, IdRancho = ranchA, Arete = "A-MAD", Raza = "Holstein", Sexo = "Hembra", FechaNacimiento = new DateTime(2020, 3, 1), FechaIngreso = new DateTime(2020, 3, 1), Procedencia = "Propio", Estado = "Activo", IdAutor = userA },
            new Animal { IdAnimal = calfA, IdRancho = ranchA, Arete = "A-CRI", Raza = "Cruza", Sexo = "Macho", FechaNacimiento = new DateTime(2023, 5, 1), FechaIngreso = new DateTime(2023, 5, 1), Procedencia = "Nacimiento", Estado = "Activo", IdAutor = userA },
            new Animal { IdAnimal = fatherB, IdRancho = ranchB, Arete = "B-PAD", Raza = "Angus", Sexo = "Macho", FechaNacimiento = new DateTime(2019, 1, 1), FechaIngreso = new DateTime(2019, 1, 1), Procedencia = "Propio", Estado = "Activo", IdAutor = userB },
            new Animal { IdAnimal = animalB, IdRancho = ranchB, Arete = "B-CRI", Raza = "Angus", Sexo = "Hembra", FechaNacimiento = new DateTime(2023, 1, 1), FechaIngreso = new DateTime(2023, 1, 1), Procedencia = "Propio", Estado = "Activo", IdAutor = userB });

        await db.SaveChangesAsync();
        db.CambiosServidor.RemoveRange(db.CambiosServidor);
        await db.SaveChangesAsync();

        return new WorldSeed(userA, userADeviceB, userB, ranchA, ranchB, grandpaA, fatherA, motherA, calfA, animalB, fatherB);
    }

    [Fact]
    public async Task PushIdempotenteYActualizacionYEliminacion_PullPaginadoEnOtroDispositivo()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var w = await SeedWorldAsync(db);

        var pushA = PushController(db, w.UserA);
        var pullB = PullController(db, w.UserADeviceB);
        var genId = Guid.NewGuid();
        var createOpId = Guid.NewGuid();

        var createReq = new OperacionSyncRequest
        {
            IdOperacion = createOpId,
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = genId,
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new
            {
                idGenealogia = genId,
                idAnimal = w.CalfA,
                idPadre = w.FatherA,
                idMadre = (Guid?)null,
                observaciones = "Alta offline"
            })
        };

        // 1. Alta inicial -> 201 Created
        var createRes = await pushA.RecibirOperacion(createReq, CancellationToken.None);
        var createdObj = Assert.IsType<CreatedAtActionResult>(createRes);
        var createdDto = Assert.IsType<OperacionSyncResponse>(createdObj.Value);
        Assert.Equal(1L, createdDto.Version);
        Assert.False(createdDto.DuplicadoIgnorado);

        // 2. Reintento con mismo idOperacion -> 200 OK idempotente sin duplicar cambios
        var retryRes = await pushA.RecibirOperacion(createReq, CancellationToken.None);
        var retryObj = Assert.IsType<OkObjectResult>(retryRes);
        var retryDto = Assert.IsType<OperacionSyncResponse>(retryObj.Value);
        Assert.True(retryDto.DuplicadoIgnorado);
        Assert.Equal(1L, retryDto.Version);
        Assert.Equal(1, await db.GenealogiasAnimales.CountAsync());
        Assert.Equal(1, await db.CambiosServidor.CountAsync(c => c.Entidad == nameof(GenealogiaAnimal)));

        // 3. Actualización (agrega madre y limpia observaciones a null) -> v2
        var updateRes = await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "genealogy",
            IdRegistro = genId,
            Operacion = "Actualizar",
            VersionBase = 1,
            Datos = JsonSerializer.SerializeToElement(new
            {
                idPadre = w.FatherA,
                idMadre = w.MotherA,
                observaciones = (string?)null
            })
        }, CancellationToken.None);
        var updateOk = Assert.IsType<OkObjectResult>(updateRes);
        Assert.Equal(2L, Assert.IsType<OperacionSyncResponse>(updateOk.Value).Version);

        // 4. Eliminación lógica -> v3
        var delRes = await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "Genealogia",
            IdRegistro = genId,
            Operacion = "Eliminar",
            VersionBase = 2,
            Datos = JsonSerializer.SerializeToElement(new { idGenealogia = genId })
        }, CancellationToken.None);
        var delOk = Assert.IsType<OkObjectResult>(delRes);
        Assert.Equal(3L, Assert.IsType<OperacionSyncResponse>(delOk.Value).Version);

        // 5. Dispositivo B hace Pull paginado (limite=1) -> recibe v1, v2 y DELETE v3 en orden determinista
        var p1 = OkPull(await pullB.GetCambios("genealogy", w.RanchA, null, null, null, 1));
        Assert.Equal("genealogy", p1.Entidad);
        Assert.True(p1.HayMasPaginas);
        var c1 = Assert.Single(p1.Cambios);
        Assert.Equal(genId, c1.RemoteId);
        Assert.Equal("UPSERT", c1.Operacion);
        Assert.Equal(1L, c1.VersionServidor);
        Assert.Equal(w.RanchA, c1.Datos!.Value.GetProperty("ranchId").GetGuid());
        Assert.Equal(w.CalfA, c1.Datos.Value.GetProperty("cattleId").GetGuid());
        Assert.Equal(w.FatherA, c1.Datos.Value.GetProperty("idPadre").GetGuid());
        Assert.Equal("Alta offline", c1.Datos.Value.GetProperty("observaciones").GetString());

        var p2 = OkPull(await pullB.GetCambios("genealogy", w.RanchA, null, null, p1.SiguienteCursorOpaco, 1));
        Assert.True(p2.HayMasPaginas);
        var c2 = Assert.Single(p2.Cambios);
        Assert.Equal("UPSERT", c2.Operacion);
        Assert.Equal(2L, c2.VersionServidor);
        Assert.Equal(w.MotherA, c2.Datos!.Value.GetProperty("idMadre").GetGuid());
        Assert.Equal(JsonValueKind.Null, c2.Datos.Value.GetProperty("observaciones").ValueKind);

        var p3 = OkPull(await pullB.GetCambios("genealogy", w.RanchA, null, null, p2.SiguienteCursorOpaco, 1));
        Assert.False(p3.HayMasPaginas);
        var c3 = Assert.Single(p3.Cambios);
        Assert.Equal("DELETE", c3.Operacion);
        Assert.True(c3.Eliminado);
        Assert.Equal(3L, c3.VersionServidor);
        Assert.Null(c3.Datos);

        // Pull posterior sin cambios conserva el cursor
        var p4 = OkPull(await pullB.GetCambios("genealogy", w.RanchA, null, null, p3.SiguienteCursorOpaco, 1));
        Assert.Empty(p4.Cambios);
        Assert.Equal(p3.SiguienteCursorOpaco, p4.SiguienteCursorOpaco);
    }

    [Fact]
    public async Task PushGenealogia_ConflictoSimultaneoYDuplicadoPorAnimal_Retorna409()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var w = await SeedWorldAsync(db);

        var pushA = PushController(db, w.UserA);
        var pushB = PushController(db, w.UserADeviceB);
        var genId = Guid.NewGuid();

        // Alta inicial v1
        var created = await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = genId,
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new
            {
                idGenealogia = genId,
                idAnimal = w.CalfA,
                idPadre = w.FatherA,
                observaciones = "v1"
            })
        }, CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(created);

        // Otro dispositivo intenta crear un segundo vínculo para el mismo animal -> 409 DUPLICATE_OR_INVALID_REFERENCE
        var dupRes = await pushB.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-b",
            Entidad = "GenealogiaAnimal",
            IdRegistro = Guid.NewGuid(),
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new
            {
                idAnimal = w.CalfA,
                idPadre = w.FatherA,
                idMadre = w.MotherA
            })
        }, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(dupRes);
        Assert.Equal(1, await db.GenealogiasAnimales.CountAsync());

        // Dispositivo B actualiza a v2
        var updateB = await pushB.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-b",
            Entidad = "GenealogiaAnimal",
            IdRegistro = genId,
            Operacion = "Actualizar",
            VersionBase = 1,
            Datos = JsonSerializer.SerializeToElement(new
            {
                idPadre = w.FatherA,
                idMadre = w.MotherA,
                observaciones = "Editado por B"
            })
        }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateB);

        // Dispositivo A intenta actualizar con versionBase=1 obsoleta -> 409 VERSION_MISMATCH
        var conflictA = await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = genId,
            Operacion = "Actualizar",
            VersionBase = 1,
            Datos = JsonSerializer.SerializeToElement(new
            {
                idPadre = w.FatherA,
                observaciones = "Editado por A offline"
            })
        }, CancellationToken.None);
        var conflictObj = Assert.IsType<ConflictObjectResult>(conflictA);
        var conflictDto = Assert.IsType<ConflictoSyncResponse>(conflictObj.Value);
        Assert.Equal("VERSION_MISMATCH", conflictDto.TipoConflicto);
        Assert.Equal(1L, conflictDto.VersionEnviada);
        Assert.Equal(2L, conflictDto.VersionServidor);
        Assert.Contains(conflictDto.CamposModificados, f => f.Campo.Equals("observaciones", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task PushGenealogia_RechazaCiclosYRelacionesInvalidas()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var w = await SeedWorldAsync(db);

        // Quitar fechas para probar específicamente detección pura de ciclo en el grafo
        var grandpa = await db.Animales.SingleAsync(a => a.IdAnimal == w.GrandpaA);
        var father = await db.Animales.SingleAsync(a => a.IdAnimal == w.FatherA);
        var calf = await db.Animales.SingleAsync(a => a.IdAnimal == w.CalfA);
        grandpa.FechaNacimiento = null;
        father.FechaNacimiento = null;
        calf.FechaNacimiento = null;
        await db.SaveChangesAsync();

        var pushA = PushController(db, w.UserA);

        // Cadena: Grandpa -> Father -> Calf
        Assert.IsType<CreatedAtActionResult>(await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = Guid.NewGuid(),
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new { idAnimal = w.FatherA, idPadre = w.GrandpaA })
        }, CancellationToken.None));

        Assert.IsType<CreatedAtActionResult>(await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = Guid.NewGuid(),
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new { idAnimal = w.CalfA, idPadre = w.FatherA })
        }, CancellationToken.None));

        // Intentar asignar Calf como padre de Grandpa -> ciclo genealógico -> 400 BadRequest
        var cycleRes = await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = Guid.NewGuid(),
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new { idAnimal = w.GrandpaA, idPadre = w.CalfA })
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(cycleRes);

        // Auto-parentesco -> 400 BadRequest
        var selfRes = await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = Guid.NewGuid(),
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new { idAnimal = w.GrandpaA, idPadre = w.GrandpaA })
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(selfRes);

        // Sexo incompatible (hembra como padre) -> 400 BadRequest
        var badSexRes = await pushA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = Guid.NewGuid(),
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new { idAnimal = w.GrandpaA, idPadre = w.MotherA })
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(badSexRes);
    }

    [Fact]
    public async Task PushYPullGenealogia_AislamientoPorRancho_BloqueaAccesosYReferenciasCruzadas()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var w = await SeedWorldAsync(db);

        // 1. Usuario A intenta Push con padre perteneciente a Rancho B -> 403 Forbidden
        var crossParentPush = await PushController(db, w.UserA).RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = w.RanchA,
            IdDispositivo = "device-a",
            Entidad = "GenealogiaAnimal",
            IdRegistro = Guid.NewGuid(),
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new
            {
                idAnimal = w.CalfA,
                idPadre = w.FatherB
            })
        }, CancellationToken.None);
        var forbidPush = Assert.IsType<ObjectResult>(crossParentPush);
        Assert.Equal(StatusCodes.Status403Forbidden, forbidPush.StatusCode);

        // 2. Usuario B intenta Pull de Rancho A -> 403 Forbid
        var forbidPull = await PullController(db, w.UserB)
            .GetCambios("genealogy", w.RanchA, null, null, null, 10);
        Assert.IsType<ForbidResult>(forbidPull.Result);

        // 3. Cambio anómalo en log de Rancho A con padre de Rancho B -> 422 REFERENCIA_INEXISTENTE sin avanzar cursor
        var badId = Guid.NewGuid();
        db.CambiosServidor.Add(new CambioServidor
        {
            IdCambio = Guid.NewGuid(),
            IdRancho = w.RanchA,
            Entidad = nameof(GenealogiaAnimal),
            IdRegistro = badId,
            Operacion = "Crear",
            Version = 1,
            OcurrioEn = new DateTime(2026, 11, 22, 18, 0, 0, DateTimeKind.Utc),
            Origen = "API",
            Datos = JsonSerializer.Serialize(new
            {
                IdAnimal = w.CalfA,
                IdPadre = w.FatherB
            })
        });
        await db.SaveChangesAsync();

        var blocked = await PullController(db, w.UserA)
            .GetCambios("genealogy", w.RanchA, null, null, null, 10);
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(blocked.Result);
        var error = Assert.IsType<PullErrorResponse>(unprocessable.Value);
        Assert.Equal("REFERENCIA_INEXISTENTE", error.Codigo);
        Assert.Equal(badId, error.RemoteId);
        Assert.Null(error.CursorVigente);
    }
}
