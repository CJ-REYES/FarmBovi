using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace FarmBovi.Tests;

public sealed class GenealogiaTests
{
    private static FarmDbContext CreateInMemoryDb(string dbName) => new(
        new DbContextOptionsBuilder<FarmDbContext>()
            .UseInMemoryDatabase(dbName)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options);

    private static GenealogiaController CreateController(FarmDbContext db, Guid userId)
    {
        var access = new RanchAccessService(db);
        var service = new GenealogiaService(db, access);
        var controller = new GenealogiaController(service);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString("D")),
            new(ClaimTypes.NameIdentifier, userId.ToString("D"))
        };
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer"))
            }
        };

        return controller;
    }

    private static TProblem AssertProblemStatus<TProblem>(IActionResult result, int expectedStatus)
        where TProblem : ProblemDetails
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        return Assert.IsAssignableFrom<TProblem>(objectResult.Value);
    }

    private static ValidationProblemDetails AssertBadRequestProblem(IActionResult result) =>
        AssertProblemStatus<ValidationProblemDetails>(result, StatusCodes.Status400BadRequest);

    private static ProblemDetails AssertConflictProblem(IActionResult result) =>
        AssertProblemStatus<ProblemDetails>(result, StatusCodes.Status409Conflict);

    private static ProblemDetails AssertNotFoundProblem(IActionResult result) =>
        AssertProblemStatus<ProblemDetails>(result, StatusCodes.Status404NotFound);

    private static ProblemDetails AssertForbiddenProblem(IActionResult result) =>
        AssertProblemStatus<ProblemDetails>(result, StatusCodes.Status403Forbidden);

    private static async Task<(Guid UserId, Guid RanchoId, Guid OtroRanchoId)> SeedBaseAsync(FarmDbContext db)
    {
        var userId = Guid.NewGuid();
        var ranchoId = Guid.NewGuid();
        var otroRanchoId = Guid.NewGuid();

        db.Usuarios.Add(new Usuario
        {
            IdUsuario = userId,
            Nombre = "Productor",
            Correo = $"user-{userId:N}@farmbovi.local",
            Contrasena = "hash",
            Estado = "activo"
        });

        db.Ranchos.AddRange(
            new Rancho
            {
                IdRancho = ranchoId,
                Nombre = "Rancho Norte",
                UbicacionGeneral = "Norte",
                Estado = "activo",
                IdAutor = userId
            },
            new Rancho
            {
                IdRancho = otroRanchoId,
                Nombre = "Rancho Ajeno",
                UbicacionGeneral = "Sur",
                Estado = "activo",
                IdAutor = userId
            });

        db.UsuarioRanchos.Add(new UsuarioRancho
        {
            IdUsuarioRancho = Guid.NewGuid(),
            IdUsuario = userId,
            IdRancho = ranchoId,
            Rol = "Administrador",
            Estado = "activo",
            FechaAlta = DateTime.UtcNow
        });

        await db.SaveChangesAsync();
        return (userId, ranchoId, otroRanchoId);
    }

    private static Animal NewAnimal(Guid ranchoId, Guid authorId, string arete, string sexo = "Macho") => new()
    {
        IdAnimal = Guid.NewGuid(),
        IdRancho = ranchoId,
        Arete = arete,
        Raza = "Holstein",
        Sexo = sexo,
        FechaIngreso = DateTime.UtcNow.Date,
        Procedencia = "Nacimiento",
        Estado = "Activo",
        IdAutor = authorId
    };

    [Fact]
    public async Task RegistrarYConsultarPadresYDescendientes_SoportaArbolMultigeneracion()
    {
        await using var db = CreateInMemoryDb(nameof(RegistrarYConsultarPadresYDescendientes_SoportaArbolMultigeneracion));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var abuelo = NewAnimal(ranchoId, userId, "ABU-01", "Macho");
        var padre = NewAnimal(ranchoId, userId, "PAD-01", "Macho");
        var madre = NewAnimal(ranchoId, userId, "MAD-01", "Hembra");
        var hijo = NewAnimal(ranchoId, userId, "HIJ-01", "Macho");
        var nieto = NewAnimal(ranchoId, userId, "NIE-01", "Hembra");

        db.Animales.AddRange(abuelo, padre, madre, hijo, nieto);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var r1 = await controller.Registrar(new RegistrarGenealogiaRequest(padre.IdAnimal, abuelo.IdAnimal, null, "Línea paterna"), default);
        Assert.IsType<CreatedAtActionResult>(r1);

        var r2 = await controller.Registrar(new RegistrarGenealogiaRequest(hijo.IdAnimal, padre.IdAnimal, madre.IdAnimal, "Cría directa"), default);
        Assert.IsType<CreatedAtActionResult>(r2);

        var r3 = await controller.Registrar(new RegistrarGenealogiaRequest(nieto.IdAnimal, hijo.IdAnimal, null), default);
        Assert.IsType<CreatedAtActionResult>(r3);

        // Consulta de padres con profundidad=2 para hijo (debe traer padre, madre y abuelo)
        var padresRes = await controller.ObtenerPadres(hijo.IdAnimal, profundidad: 2, default);
        var padresOk = Assert.IsType<OkObjectResult>(padresRes);
        var padresPayload = Assert.IsType<PadresAnimalResponse>(padresOk.Value);

        Assert.Equal(padre.IdAnimal, padresPayload.Padre?.IdAnimal);
        Assert.Equal(madre.IdAnimal, padresPayload.Madre?.IdAnimal);
        Assert.Equal("Cría directa", padresPayload.Observaciones);
        Assert.Equal(3, padresPayload.Ancestros.Count);
        Assert.Contains(padresPayload.Ancestros, a => a.Generacion == 2 && a.Animal.IdAnimal == abuelo.IdAnimal);

        // Consulta de descendientes desde abuelo con profundidad=3 (padre -> hijo -> nieto)
        var descRes = await controller.ObtenerDescendientes(abuelo.IdAnimal, profundidad: 3, default);
        var descOk = Assert.IsType<OkObjectResult>(descRes);
        var descPayload = Assert.IsType<DescendientesAnimalResponse>(descOk.Value);

        Assert.Equal(3, descPayload.TotalDescendientes);
        Assert.Contains(descPayload.Descendientes, d => d.Generacion == 1 && d.Descendiente.IdAnimal == padre.IdAnimal);
        Assert.Contains(descPayload.Descendientes, d => d.Generacion == 2 && d.Descendiente.IdAnimal == hijo.IdAnimal);
        Assert.Contains(descPayload.Descendientes, d => d.Generacion == 3 && d.Descendiente.IdAnimal == nieto.IdAnimal);
    }

    [Fact]
    public async Task Registrar_AnimalComoSuPropioPadreOMadre_Retorna400BadRequest()
    {
        await using var db = CreateInMemoryDb(nameof(Registrar_AnimalComoSuPropioPadreOMadre_Retorna400BadRequest));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var toro = NewAnimal(ranchoId, userId, "TORO-01", "Macho");
        var vaca = NewAnimal(ranchoId, userId, "VACA-01", "Hembra");
        db.Animales.AddRange(toro, vaca);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var selfFather = await controller.Registrar(new RegistrarGenealogiaRequest(toro.IdAnimal, toro.IdAnimal, vaca.IdAnimal), default);
        AssertBadRequestProblem(selfFather);

        var selfMother = await controller.Registrar(new RegistrarGenealogiaRequest(vaca.IdAnimal, toro.IdAnimal, vaca.IdAnimal), default);
        AssertBadRequestProblem(selfMother);

        var sameParents = await controller.Registrar(new RegistrarGenealogiaRequest(toro.IdAnimal, vaca.IdAnimal, vaca.IdAnimal), default);
        AssertBadRequestProblem(sameParents);
    }

    [Fact]
    public async Task Registrar_CicloGenealogicoDirectoEIndirecto_Retorna400BadRequest()
    {
        await using var db = CreateInMemoryDb(nameof(Registrar_CicloGenealogicoDirectoEIndirecto_Retorna400BadRequest));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var a = NewAnimal(ranchoId, userId, "A-01", "Macho");
        var b = NewAnimal(ranchoId, userId, "B-01", "Hembra");
        var c = NewAnimal(ranchoId, userId, "C-01", "Macho");
        db.Animales.AddRange(a, b, c);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        // A es padre de B; B es madre de C
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(b.IdAnimal, a.IdAnimal, null), default));
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(c.IdAnimal, null, b.IdAnimal), default));

        // Ciclo directo: B -> A
        var directCycle = await controller.Registrar(new RegistrarGenealogiaRequest(a.IdAnimal, b.IdAnimal, null), default);
        AssertBadRequestProblem(directCycle);

        // Ciclo indirecto (3 generaciones): C -> A
        var indirectCycle = await controller.Registrar(new RegistrarGenealogiaRequest(a.IdAnimal, c.IdAnimal, null), default);
        AssertBadRequestProblem(indirectCycle);
    }

    [Fact]
    public async Task RegistrarYConsultar_RanchoAjeno_Retorna403Forbidden()
    {
        await using var db = CreateInMemoryDb(nameof(RegistrarYConsultar_RanchoAjeno_Retorna403Forbidden));
        var (userId, ranchoId, otroRanchoId) = await SeedBaseAsync(db);

        var animalPropio = NewAnimal(ranchoId, userId, "PROP-01");
        var animalAjeno = NewAnimal(otroRanchoId, userId, "AJEN-01");
        db.Animales.AddRange(animalPropio, animalAjeno);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var forbiddenParent = await controller.Registrar(new RegistrarGenealogiaRequest(animalPropio.IdAnimal, animalAjeno.IdAnimal, null), default);
        var p1 = AssertForbiddenProblem(forbiddenParent);
        Assert.DoesNotContain("AJEN-01", p1.Detail ?? string.Empty);
        Assert.DoesNotContain(otroRanchoId.ToString(), p1.Detail ?? string.Empty);

        var forbiddenQuery = await controller.ObtenerPadres(animalAjeno.IdAnimal, 1, default);
        var p2 = AssertForbiddenProblem(forbiddenQuery);
        Assert.DoesNotContain("AJEN-01", p2.Detail ?? string.Empty);
    }

    [Fact]
    public async Task ActualizarYEliminarGenealogia_ActualizaVersionYPermiteReasignar()
    {
        await using var db = CreateInMemoryDb(nameof(ActualizarYEliminarGenealogia_ActualizaVersionYPermiteReasignar));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var p1 = NewAnimal(ranchoId, userId, "P1");
        var p2 = NewAnimal(ranchoId, userId, "P2");
        var m1 = NewAnimal(ranchoId, userId, "M1", "Hembra");
        var cria = NewAnimal(ranchoId, userId, "CRIA");
        db.Animales.AddRange(p1, p2, m1, cria);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, p1.IdAnimal, null), default));

        var updateRes = await controller.Actualizar(cria.IdAnimal, new ActualizarGenealogiaRequest(p2.IdAnimal, m1.IdAnimal, "Corregido", VersionRegistro: 1), default);
        var updateOk = Assert.IsType<OkObjectResult>(updateRes);
        var updatedDto = Assert.IsType<GenealogiaRegistroDto>(updateOk.Value);
        Assert.Equal(p2.IdAnimal, updatedDto.IdPadre);
        Assert.Equal(m1.IdAnimal, updatedDto.IdMadre);
        Assert.Equal(2, updatedDto.VersionRegistro);

        Assert.IsType<NoContentResult>(await controller.Eliminar(cria.IdAnimal, versionRegistro: 2, ct: default));
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, p1.IdAnimal, m1.IdAnimal), default));
    }

    [Fact]
    public async Task ObtenerPadresYDescendientes_AislamientoPorRancho_NoExponeRelacionesDeOtroRancho()
    {
        await using var db = CreateInMemoryDb(nameof(ObtenerPadresYDescendientes_AislamientoPorRancho_NoExponeRelacionesDeOtroRancho));
        var (userId, ranchoId, otroRanchoId) = await SeedBaseAsync(db);

        var abueloAjeno = NewAnimal(otroRanchoId, userId, "ABU-AJ", "Macho");
        var padrePropio = NewAnimal(ranchoId, userId, "PAD-PR", "Macho");
        var hijoPropio = NewAnimal(ranchoId, userId, "HIJ-PR", "Macho");
        var nietoAjeno = NewAnimal(otroRanchoId, userId, "NIE-AJ", "Hembra");

        db.Animales.AddRange(abueloAjeno, padrePropio, hijoPropio, nietoAjeno);
        // Se siembran directamente en BD relaciones cruzadas para comprobar que el SQL las excluye.
        db.GenealogiasAnimales.AddRange(
            new GenealogiaAnimal { IdAnimal = padrePropio.IdAnimal, IdPadre = abueloAjeno.IdAnimal, IdAutor = userId },
            new GenealogiaAnimal { IdAnimal = hijoPropio.IdAnimal, IdPadre = padrePropio.IdAnimal, IdAutor = userId },
            new GenealogiaAnimal { IdAnimal = nietoAjeno.IdAnimal, IdPadre = hijoPropio.IdAnimal, IdAutor = userId });
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var padresRes = Assert.IsType<OkObjectResult>(await controller.ObtenerPadres(hijoPropio.IdAnimal, profundidad: 3, default));
        var padres = Assert.IsType<PadresAnimalResponse>(padresRes.Value);
        Assert.Equal(padrePropio.IdAnimal, padres.Padre?.IdAnimal);
        Assert.Single(padres.Ancestros);
        Assert.DoesNotContain(padres.Ancestros, a => a.Animal.IdRancho == otroRanchoId);

        var descRes = Assert.IsType<OkObjectResult>(await controller.ObtenerDescendientes(padrePropio.IdAnimal, profundidad: 3, default));
        var desc = Assert.IsType<DescendientesAnimalResponse>(descRes.Value);
        Assert.Equal(1, desc.TotalDescendientes);
        Assert.Single(desc.Descendientes);
        Assert.Equal(hijoPropio.IdAnimal, desc.Descendientes[0].Descendiente.IdAnimal);
    }

    [Fact]
    public async Task Registrar_SexoIncorrectoODesconocido_ValidaReglasDeDominio()
    {
        await using var db = CreateInMemoryDb(nameof(Registrar_SexoIncorrectoODesconocido_ValidaReglasDeDominio));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var vacaComoPadre = NewAnimal(ranchoId, userId, "V-PAD", "Hembra");
        var toroComoMadre = NewAnimal(ranchoId, userId, "T-MAD", "Macho");
        var sexoDesconocido = NewAnimal(ranchoId, userId, "DESC-1", "Desconocido");
        var cria1 = NewAnimal(ranchoId, userId, "CRIA-1", "Macho");
        var cria2 = NewAnimal(ranchoId, userId, "CRIA-2", "Hembra");
        db.Animales.AddRange(vacaComoPadre, toroComoMadre, sexoDesconocido, cria1, cria2);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var padreHembra = await controller.Registrar(new RegistrarGenealogiaRequest(cria1.IdAnimal, vacaComoPadre.IdAnimal, null), default);
        AssertBadRequestProblem(padreHembra);

        var madreMacho = await controller.Registrar(new RegistrarGenealogiaRequest(cria1.IdAnimal, null, toroComoMadre.IdAnimal), default);
        AssertBadRequestProblem(madreMacho);

        // Sexo desconocido no bloquea registros incompletos.
        var unknownAllowed = await controller.Registrar(new RegistrarGenealogiaRequest(cria2.IdAnimal, sexoDesconocido.IdAnimal, null), default);
        Assert.IsType<CreatedAtActionResult>(unknownAllowed);
    }

    [Fact]
    public async Task Registrar_FechasNacimientoIncompatiblesODesconocidas_ValidaCronologia()
    {
        await using var db = CreateInMemoryDb(nameof(Registrar_FechasNacimientoIncompatiblesODesconocidas_ValidaCronologia));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var padreJoven = NewAnimal(ranchoId, userId, "PJ", "Macho");
        padreJoven.FechaNacimiento = new DateTime(2024, 5, 10);

        var madreMismoDia = NewAnimal(ranchoId, userId, "MM", "Hembra");
        madreMismoDia.FechaNacimiento = new DateTime(2024, 1, 10);

        var padreSinFecha = NewAnimal(ranchoId, userId, "PSF", "Macho");
        padreSinFecha.FechaNacimiento = null;

        var cria = NewAnimal(ranchoId, userId, "CRIA-F", "Macho");
        cria.FechaNacimiento = new DateTime(2024, 1, 10);

        db.Animales.AddRange(padreJoven, madreMismoDia, padreSinFecha, cria);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        AssertBadRequestProblem(
            await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, padreJoven.IdAnimal, null), default));

        AssertBadRequestProblem(
            await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, null, madreMismoDia.IdAnimal), default));

        Assert.IsType<CreatedAtActionResult>(
            await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, padreSinFecha.IdAnimal, null), default));
    }

    [Fact]
    public async Task RegistrarYActualizar_Observaciones500AceptadasY501Rechazadas()
    {
        await using var db = CreateInMemoryDb(nameof(RegistrarYActualizar_Observaciones500AceptadasY501Rechazadas));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var padre = NewAnimal(ranchoId, userId, "P-OBS", "Macho");
        var cria = NewAnimal(ranchoId, userId, "C-OBS", "Hembra");
        db.Animales.AddRange(padre, cria);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var obs501 = new string('x', 501);
        var obs500 = "  " + new string('a', 500) + "  ";

        var bad501 = await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, padre.IdAnimal, null, obs501), default);
        AssertBadRequestProblem(bad501);

        var ok500 = await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, padre.IdAnimal, null, obs500), default);
        var created = Assert.IsType<CreatedAtActionResult>(ok500);
        var dto = Assert.IsType<GenealogiaRegistroDto>(created.Value);
        Assert.Equal(500, dto.Observaciones?.Length);

        var badUpdate501 = await controller.Actualizar(cria.IdAnimal, new ActualizarGenealogiaRequest(padre.IdAnimal, null, obs501, VersionRegistro: 1), default);
        AssertBadRequestProblem(badUpdate501);
    }

    [Fact]
    public async Task ObtenerDescendientes_ConvergenciaPorConsanguinidad_NoDuplicaDescendientes()
    {
        await using var db = CreateInMemoryDb(nameof(ObtenerDescendientes_ConvergenciaPorConsanguinidad_NoDuplicaDescendientes));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var ancestro = NewAnimal(ranchoId, userId, "ANC-1", "Macho");
        var hijoMacho = NewAnimal(ranchoId, userId, "HM-1", "Macho");
        var hijaHembra = NewAnimal(ranchoId, userId, "HH-1", "Hembra");
        var nietoConvergente = NewAnimal(ranchoId, userId, "NC-1", "Macho");
        db.Animales.AddRange(ancestro, hijoMacho, hijaHembra, nietoConvergente);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(hijoMacho.IdAnimal, ancestro.IdAnimal, null), default));
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(hijaHembra.IdAnimal, ancestro.IdAnimal, null), default));
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(nietoConvergente.IdAnimal, hijoMacho.IdAnimal, hijaHembra.IdAnimal), default));

        var descRes = Assert.IsType<OkObjectResult>(await controller.ObtenerDescendientes(ancestro.IdAnimal, profundidad: 3, default));
        var desc = Assert.IsType<DescendientesAnimalResponse>(descRes.Value);

        Assert.Equal(3, desc.TotalDescendientes);
        Assert.Equal(3, desc.Descendientes.Count);
        Assert.Equal(1, desc.Descendientes.Count(d => d.Descendiente.IdAnimal == nietoConvergente.IdAnimal));
    }

    [Fact]
    public async Task ObtenerPorIdYCreatedAtAction_ApuntaAlRecursoCreado()
    {
        await using var db = CreateInMemoryDb(nameof(ObtenerPorIdYCreatedAtAction_ApuntaAlRecursoCreado));
        var (userId, ranchoId, otroRanchoId) = await SeedBaseAsync(db);

        var padre = NewAnimal(ranchoId, userId, "P-GET", "Macho");
        var cria = NewAnimal(ranchoId, userId, "C-GET", "Hembra");
        var ajeno = NewAnimal(otroRanchoId, userId, "AJ-GET", "Hembra");
        var padreAjeno = NewAnimal(otroRanchoId, userId, "PAJ-GET", "Macho");
        db.Animales.AddRange(padre, cria, ajeno, padreAjeno);
        var relAjena = new GenealogiaAnimal { IdAnimal = ajeno.IdAnimal, IdPadre = padreAjeno.IdAnimal, IdAutor = userId };
        db.GenealogiasAnimales.Add(relAjena);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var postRes = await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, padre.IdAnimal, null, "Directo"), default);
        var created = Assert.IsType<CreatedAtActionResult>(postRes);
        Assert.Equal(nameof(GenealogiaController.ObtenerPorId), created.ActionName);
        var createdDto = Assert.IsType<GenealogiaRegistroDto>(created.Value);
        Assert.Equal(createdDto.IdGenealogia, created.RouteValues?["idGenealogia"]);

        var getRes = Assert.IsType<OkObjectResult>(await controller.ObtenerPorId(createdDto.IdGenealogia, default));
        var fetched = Assert.IsType<GenealogiaRegistroDto>(getRes.Value);
        Assert.Equal(createdDto.IdGenealogia, fetched.IdGenealogia);

        AssertNotFoundProblem(await controller.ObtenerPorId(Guid.NewGuid(), default));

        AssertForbiddenProblem(await controller.ObtenerPorId(relAjena.IdGenealogia, default));
    }

    [Fact]
    public async Task Actualizar_ConcurrenciaYVersionDesactualizada_Retorna409Conflict()
    {
        var dbName = nameof(Actualizar_ConcurrenciaYVersionDesactualizada_Retorna409Conflict);
        Guid userId;
        Guid criaId;
        Guid padre1Id;
        Guid padre2Id;

        await using (var seedDb = CreateInMemoryDb(dbName))
        {
            (userId, var ranchoId, _) = await SeedBaseAsync(seedDb);
            var p1 = NewAnimal(ranchoId, userId, "PC-1", "Macho");
            var p2 = NewAnimal(ranchoId, userId, "PC-2", "Macho");
            var cria = NewAnimal(ranchoId, userId, "CC-1", "Hembra");
            seedDb.Animales.AddRange(p1, p2, cria);
            await seedDb.SaveChangesAsync();

            var c = CreateController(seedDb, userId);
            Assert.IsType<CreatedAtActionResult>(await c.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, p1.IdAnimal, null), default));
            criaId = cria.IdAnimal;
            padre1Id = p1.IdAnimal;
            padre2Id = p2.IdAnimal;
        }

        // Conflicto por VersionRegistro desactualizada enviada por cliente.
        await using (var db1 = CreateInMemoryDb(dbName))
        {
            var c1 = CreateController(db1, userId);
            var okRes = await c1.Actualizar(criaId, new ActualizarGenealogiaRequest(padre2Id, null, "v2", VersionRegistro: 1), default);
            Assert.IsType<OkObjectResult>(okRes);

            var staleRes = await c1.Actualizar(criaId, new ActualizarGenealogiaRequest(padre1Id, null, "stale", VersionRegistro: 1), default);
            AssertConflictProblem(staleRes);
        }

        // Conflicto optimista real de EF Core (DbUpdateConcurrencyException) entre dos servicios concurrentes.
        await using var dbA = CreateInMemoryDb(dbName);
        await using var dbB = CreateInMemoryDb(dbName);

        var regA = await dbA.GenealogiasAnimales.FirstAsync(g => g.IdAnimal == criaId);
        var regB = await dbB.GenealogiasAnimales.FirstAsync(g => g.IdAnimal == criaId);
        Assert.Equal(regA.VersionRegistro, regB.VersionRegistro);

        regA.Observaciones = "Cambio A";
        regA.VersionRegistro += 1;
        await dbA.SaveChangesAsync();

        var serviceB = new GenealogiaService(dbB, new RanchAccessService(dbB));
        var conflictRes = await serviceB.ActualizarAsync(criaId, new ActualizarGenealogiaRequest(padre1Id, null, "Cambio B", VersionRegistro: regB.VersionRegistro), userId, default);
        Assert.Equal(GenealogiaOperationStatus.Conflict, conflictRes.Status);
    }

    [Fact]
    public async Task Genealogia_EmiteCambiosServidorEnCrearActualizarYEliminar()
    {
        await using var db = CreateInMemoryDb(nameof(Genealogia_EmiteCambiosServidorEnCrearActualizarYEliminar));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var padre = NewAnimal(ranchoId, userId, "P-SYNC", "Macho");
        var madre = NewAnimal(ranchoId, userId, "M-SYNC", "Hembra");
        var cria = NewAnimal(ranchoId, userId, "C-SYNC", "Macho");
        db.Animales.AddRange(padre, madre, cria);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        var created = Assert.IsType<CreatedAtActionResult>(
            await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, padre.IdAnimal, null, "Alta"), default));
        var dto = Assert.IsType<GenealogiaRegistroDto>(created.Value);

        Assert.IsType<OkObjectResult>(
            await controller.Actualizar(cria.IdAnimal, new ActualizarGenealogiaRequest(padre.IdAnimal, madre.IdAnimal, "Edit", VersionRegistro: 1), default));

        Assert.IsType<NoContentResult>(await controller.Eliminar(cria.IdAnimal, versionRegistro: 2, ct: default));

        var cambios = await db.CambiosServidor.AsNoTracking()
            .Where(c => c.Entidad == nameof(GenealogiaAnimal) && c.IdRegistro == dto.IdGenealogia)
            .OrderBy(c => c.Version)
            .ToListAsync();

        Assert.Equal(3, cambios.Count);
        Assert.All(cambios, c => Assert.Equal(ranchoId, c.IdRancho));
        Assert.Equal(["Crear", "Actualizar", "Eliminar"], cambios.Select(c => c.Operacion).ToArray());
        Assert.Equal([1L, 2L, 3L], cambios.Select(c => c.Version).ToArray());
        Assert.NotNull(cambios[0].Datos);
        Assert.NotNull(cambios[1].Datos);
        Assert.Null(cambios[2].Datos);

        using var payloadDoc = JsonDocument.Parse(cambios[1].Datos!);
        var root = payloadDoc.RootElement;
        Assert.Equal(dto.IdGenealogia, root.GetProperty("idGenealogia").GetGuid());
        Assert.Equal(cria.IdAnimal, root.GetProperty("idAnimal").GetGuid());
        Assert.Equal(padre.IdAnimal, root.GetProperty("idPadre").GetGuid());
        Assert.Equal(madre.IdAnimal, root.GetProperty("idMadre").GetGuid());
        Assert.Equal(2L, root.GetProperty("versionRegistro").GetInt64());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("eliminadoEn").ValueKind);

        using var deleteDoc = JsonDocument.Parse(cambios[2].Despues!);
        Assert.NotEqual(JsonValueKind.Null, deleteDoc.RootElement.GetProperty("eliminadoEn").ValueKind);
        Assert.Equal(3L, deleteDoc.RootElement.GetProperty("versionRegistro").GetInt64());
    }

    [Fact]
    public async Task UsuarioConAccesoADosRanchos_NoPuedeCruzarParentescoNiConsultarEntreRanchos()
    {
        await using var db = CreateInMemoryDb(nameof(UsuarioConAccesoADosRanchos_NoPuedeCruzarParentescoNiConsultarEntreRanchos));
        var (userId, ranchoA, ranchoB) = await SeedBaseAsync(db);

        // El mismo usuario tiene membresía activa en ambos ranchos (A y B).
        db.UsuarioRanchos.Add(new UsuarioRancho
        {
            IdUsuarioRancho = Guid.NewGuid(),
            IdUsuario = userId,
            IdRancho = ranchoB,
            Rol = "Administrador",
            Estado = "activo",
            FechaAlta = DateTime.UtcNow
        });

        var padreRanchoA = NewAnimal(ranchoA, userId, "A-PAD", "Macho");
        var criaRanchoA = NewAnimal(ranchoA, userId, "A-CRIA", "Macho");
        // Progenitores en Rancho B con arete identificable y hasta sexo incompatible para comprobar
        // que el aislamiento rechaza antes de validar o revelar datos de Rancho B.
        var padreRanchoB = NewAnimal(ranchoB, userId, "B-SECRETO-PAD", "Hembra");
        var madreRanchoB = NewAnimal(ranchoB, userId, "B-SECRETO-MAD", "Macho");
        padreRanchoB.FechaNacimiento = new DateTime(2030, 1, 1);
        criaRanchoA.FechaNacimiento = new DateTime(2024, 1, 1);

        db.Animales.AddRange(padreRanchoA, criaRanchoA, padreRanchoB, madreRanchoB);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        // Intento cruzado por padre (Rancho A -> Rancho B).
        var crossFather = await controller.Registrar(
            new RegistrarGenealogiaRequest(criaRanchoA.IdAnimal, padreRanchoB.IdAnimal, null),
            default);
        var fatherProblem = AssertBadRequestProblem(crossFather);
        Assert.DoesNotContain("B-SECRETO-PAD", fatherProblem.Detail ?? string.Empty);
        Assert.DoesNotContain(ranchoB.ToString(), fatherProblem.Detail ?? string.Empty);
        Assert.DoesNotContain("sexo", fatherProblem.Detail ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("fecha", fatherProblem.Detail ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        // Intento cruzado por madre (Rancho A -> Rancho B).
        var crossMother = await controller.Registrar(
            new RegistrarGenealogiaRequest(criaRanchoA.IdAnimal, padreRanchoA.IdAnimal, madreRanchoB.IdAnimal),
            default);
        var motherProblem = AssertBadRequestProblem(crossMother);
        Assert.DoesNotContain("B-SECRETO-MAD", motherProblem.Detail ?? string.Empty);
        Assert.DoesNotContain(ranchoB.ToString(), motherProblem.Detail ?? string.Empty);
        Assert.DoesNotContain("sexo", motherProblem.Detail ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        // Si en BD existieran relaciones cruzadas entre Ranchos A y B del mismo usuario multi-rancho,
        // las consultas deben aislarse estrictamente al rancho del animal consultado.
        db.GenealogiasAnimales.AddRange(
            new GenealogiaAnimal { IdAnimal = criaRanchoA.IdAnimal, IdPadre = padreRanchoB.IdAnimal, IdAutor = userId },
            new GenealogiaAnimal { IdAnimal = padreRanchoB.IdAnimal, IdPadre = madreRanchoB.IdAnimal, IdAutor = userId });
        await db.SaveChangesAsync();

        var padresA = Assert.IsType<OkObjectResult>(await controller.ObtenerPadres(criaRanchoA.IdAnimal, profundidad: 3, default));
        var padresPayload = Assert.IsType<PadresAnimalResponse>(padresA.Value);
        Assert.Null(padresPayload.Padre);
        Assert.Empty(padresPayload.Ancestros);

        var descB = Assert.IsType<OkObjectResult>(await controller.ObtenerDescendientes(padreRanchoB.IdAnimal, profundidad: 3, default));
        var descPayload = Assert.IsType<DescendientesAnimalResponse>(descB.Value);
        Assert.Equal(0, descPayload.TotalDescendientes);
        Assert.Empty(descPayload.Descendientes);
    }

    [Fact]
    public async Task Eliminar_ExigeVersionObligatoriaOIfMatchYRechazaObsoleta()
    {
        await using var db = CreateInMemoryDb(nameof(Eliminar_ExigeVersionObligatoriaOIfMatchYRechazaObsoleta));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var padre = NewAnimal(ranchoId, userId, "P-DEL", "Macho");
        var cria = NewAnimal(ranchoId, userId, "C-DEL", "Hembra");
        db.Animales.AddRange(padre, cria);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);
        var created = Assert.IsType<CreatedAtActionResult>(
            await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, padre.IdAnimal, null, "v1"), default));
        var dto = Assert.IsType<GenealogiaRegistroDto>(created.Value);
        Assert.Equal(1L, dto.VersionRegistro);

        // 1. Versión ausente -> 400 BadRequest (ValidationProblemDetails).
        AssertBadRequestProblem(await controller.Eliminar(cria.IdAnimal, versionRegistro: null, ct: default));
        AssertBadRequestProblem(await controller.Eliminar(cria.IdAnimal, versionRegistro: 0, ct: default));

        // 2. Versión obsoleta/incorrecta -> 409 Conflict (ProblemDetails).
        AssertConflictProblem(await controller.Eliminar(cria.IdAnimal, versionRegistro: 99, ct: default));

        // 3. Versión correcta por cabecera If-Match -> 204 NoContent, incrementa VersionRegistro y emite CambioServidor.
        controller.HttpContext.Request.Headers.IfMatch = "\"1\"";
        Assert.IsType<NoContentResult>(await controller.Eliminar(cria.IdAnimal, versionRegistro: null, ct: default));

        var deleted = await db.GenealogiasAnimales.AsNoTracking().FirstAsync(g => g.IdAnimal == cria.IdAnimal);
        Assert.NotNull(deleted.EliminadoEn);
        Assert.Equal(2L, deleted.VersionRegistro);

        var deleteEvent = await db.CambiosServidor.AsNoTracking()
            .Where(c => c.Entidad == nameof(GenealogiaAnimal) && c.IdRegistro == dto.IdGenealogia && c.Operacion == "Eliminar")
            .FirstOrDefaultAsync();
        Assert.NotNull(deleteEvent);
        Assert.Equal(2L, deleteEvent!.Version);
    }
}

public sealed class GenealogiaApiTests : IAsyncLifetime
{
    private readonly FarmBoviApiFactory _factory = new();
    private readonly Guid _userA = Guid.NewGuid();
    private readonly Guid _userB = Guid.NewGuid();
    private readonly Guid _ranchA = Guid.NewGuid();
    private readonly Guid _ranchB = Guid.NewGuid();
    private readonly Guid _padreA = Guid.NewGuid();
    private readonly Guid _madreA = Guid.NewGuid();
    private readonly Guid _criaA = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _factory.SeedAsync(db =>
        {
            db.Usuarios.AddRange(
                new Usuario { IdUsuario = _userA, Nombre = "UserA", Correo = "ua@farmbovi.test", Contrasena = "h", Estado = "Activo" },
                new Usuario { IdUsuario = _userB, Nombre = "UserB", Correo = "ub@farmbovi.test", Contrasena = "h", Estado = "Activo" });

            db.Ranchos.AddRange(
                new Rancho { IdRancho = _ranchA, Nombre = "Rancho A", UbicacionGeneral = "N", Estado = "Activo", IdAutor = _userA },
                new Rancho { IdRancho = _ranchB, Nombre = "Rancho B", UbicacionGeneral = "S", Estado = "Activo", IdAutor = _userB });

            db.UsuarioRanchos.AddRange(
                new UsuarioRancho { IdUsuario = _userA, IdRancho = _ranchA, Rol = "Administrador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userB, IdRancho = _ranchB, Rol = "Administrador", Estado = "Activo" });

            db.Animales.AddRange(
                new Animal { IdAnimal = _padreA, IdRancho = _ranchA, Arete = "PA-1", Raza = "Brahman", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = _userA },
                new Animal { IdAnimal = _madreA, IdRancho = _ranchA, Arete = "MA-1", Raza = "Brahman", Sexo = "Hembra", Procedencia = "Propio", Estado = "Activo", IdAutor = _userA },
                new Animal { IdAnimal = _criaA, IdRancho = _ranchA, Arete = "CA-1", Raza = "Brahman", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = _userA });

            return Task.CompletedTask;
        });
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private HttpClient Client(Guid? userId = null)
    {
        var client = _factory.CreateClient();
        if (userId is { } id)
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(id));
        return client;
    }

    [Fact]
    public async Task PipelineHttpReal_AuthLocationValidacionYCrudCompleto()
    {
        using var anonClient = Client();
        var unauth = await anonClient.GetAsync($"/api/genealogia/{_criaA}/padres");
        Assert.Equal(HttpStatusCode.Unauthorized, unauth.StatusCode);

        using var clientA = Client(_userA);
        using var clientB = Client(_userB);

        // 400 por observaciones de 501 caracteres (validación DTO en pipeline HTTP).
        var badObsRes = await clientA.PostAsJsonAsync("/api/genealogia", new
        {
            idAnimal = _criaA,
            idPadre = _padreA,
            idMadre = _madreA,
            observaciones = new string('z', 501)
        });
        Assert.Equal(HttpStatusCode.BadRequest, badObsRes.StatusCode);

        // 201 Created con Location apuntando a GET /api/genealogia/{idGenealogia}.
        var createRes = await clientA.PostAsJsonAsync("/api/genealogia", new
        {
            idAnimal = _criaA,
            idPadre = _padreA,
            idMadre = _madreA,
            observaciones = "Registro HTTP"
        });
        Assert.Equal(HttpStatusCode.Created, createRes.StatusCode);
        Assert.NotNull(createRes.Headers.Location);

        var createdDto = await createRes.Content.ReadFromJsonAsync<GenealogiaRegistroDto>();
        Assert.NotNull(createdDto);
        Assert.Contains($"/api/genealogia/{createdDto!.IdGenealogia}", createRes.Headers.Location!.ToString(), StringComparison.OrdinalIgnoreCase);

        // GET directo al Location creado.
        var getDirect = await clientA.GetAsync(createRes.Headers.Location);
        Assert.Equal(HttpStatusCode.OK, getDirect.StatusCode);

        // Reintento idempotente de POST idéntico -> 200 OK con el mismo registro; POST diferente -> 409 ProblemDetails.
        var retrySamePost = await clientA.PostAsJsonAsync("/api/genealogia", new
        {
            idAnimal = _criaA,
            idPadre = _padreA,
            idMadre = _madreA,
            observaciones = "Registro HTTP"
        });
        Assert.Equal(HttpStatusCode.OK, retrySamePost.StatusCode);
        var retryDto = await retrySamePost.Content.ReadFromJsonAsync<GenealogiaRegistroDto>();
        Assert.Equal(createdDto.IdGenealogia, retryDto?.IdGenealogia);

        var retryDiffPost = await clientA.PostAsJsonAsync("/api/genealogia", new
        {
            idAnimal = _criaA,
            idPadre = _padreA,
            idMadre = (Guid?)null,
            observaciones = "Cambio en POST"
        });
        await AssertHttpProblemAsync(retryDiffPost, HttpStatusCode.Conflict);

        // 403 Forbidden desde otro rancho en formato ProblemDetails (sin propiedad "mensaje").
        var getOtherRanch = await clientB.GetAsync($"/api/genealogia/{createdDto.IdGenealogia}");
        await AssertHttpProblemAsync(getOtherRanch, HttpStatusCode.Forbidden);

        // 400 BadRequest al actualizar sin enviar versionRegistro, con 0 o con negativo.
        var missingVersionPut = await clientA.PutAsJsonAsync($"/api/genealogia/{_criaA}", new
        {
            idPadre = _padreA,
            idMadre = (Guid?)null,
            observaciones = "Sin versión"
        });
        await AssertHttpValidationProblemAsync(missingVersionPut);

        var zeroVersionPut = await clientA.PutAsJsonAsync($"/api/genealogia/{_criaA}", new
        {
            idPadre = _padreA,
            idMadre = (Guid?)null,
            observaciones = "Versión cero",
            versionRegistro = 0L
        });
        await AssertHttpValidationProblemAsync(zeroVersionPut);

        var negativeVersionPut = await clientA.PutAsJsonAsync($"/api/genealogia/{_criaA}", new
        {
            idPadre = _padreA,
            idMadre = (Guid?)null,
            observaciones = "Versión negativa",
            versionRegistro = -2L
        });
        await AssertHttpValidationProblemAsync(negativeVersionPut);

        // 409 Conflict al actualizar con versión obsoleta.
        var stalePut = await clientA.PutAsJsonAsync($"/api/genealogia/{_criaA}", new
        {
            idPadre = _padreA,
            idMadre = (Guid?)null,
            observaciones = "Stale",
            versionRegistro = 99L
        });
        await AssertHttpProblemAsync(stalePut, HttpStatusCode.Conflict);

        // 200 OK en PUT válido (incrementa versión a 2).
        var validPut = await clientA.PutAsJsonAsync($"/api/genealogia/{_criaA}", new
        {
            idPadre = _padreA,
            idMadre = (Guid?)null,
            observaciones = "Actualizado",
            versionRegistro = 1L
        });
        Assert.Equal(HttpStatusCode.OK, validPut.StatusCode);

        // 400 BadRequest en DELETE sin versión o con If-Match inválido.
        var missingVersionDel = await clientA.DeleteAsync($"/api/genealogia/{_criaA}");
        await AssertHttpValidationProblemAsync(missingVersionDel);

        using (var invalidIfMatchReq = new HttpRequestMessage(HttpMethod.Delete, $"/api/genealogia/{_criaA}"))
        {
            invalidIfMatchReq.Headers.TryAddWithoutValidation("If-Match", "\"no-es-numero\"");
            var invalidIfMatchDel = await clientA.SendAsync(invalidIfMatchReq);
            await AssertHttpValidationProblemAsync(invalidIfMatchDel);
        }

        // 409 Conflict en DELETE con versión obsoleta (por query y por If-Match).
        var staleDel = await clientA.DeleteAsync($"/api/genealogia/{_criaA}?versionRegistro=1");
        await AssertHttpProblemAsync(staleDel, HttpStatusCode.Conflict);

        using (var staleIfMatchReq = new HttpRequestMessage(HttpMethod.Delete, $"/api/genealogia/{_criaA}"))
        {
            staleIfMatchReq.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
            var staleIfMatchDel = await clientA.SendAsync(staleIfMatchReq);
            await AssertHttpProblemAsync(staleIfMatchDel, HttpStatusCode.Conflict);
        }

        // 204 NoContent en DELETE con If-Match válido (versión 2) y 404 ProblemDetails en GET posterior.
        using (var validIfMatchReq = new HttpRequestMessage(HttpMethod.Delete, $"/api/genealogia/{_criaA}"))
        {
            validIfMatchReq.Headers.TryAddWithoutValidation("If-Match", "\"2\"");
            var delRes = await clientA.SendAsync(validIfMatchReq);
            Assert.Equal(HttpStatusCode.NoContent, delRes.StatusCode);
        }

        var getAfterDel = await clientA.GetAsync($"/api/genealogia/{createdDto.IdGenealogia}");
        await AssertHttpProblemAsync(getAfterDel, HttpStatusCode.NotFound);
    }

    private static async Task AssertHttpValidationProblemAsync(HttpResponseMessage response)
    {
        var doc = await AssertHttpProblemCoreAsync(response, HttpStatusCode.BadRequest);
        Assert.True(doc.RootElement.TryGetProperty("errors", out _));
    }

    private static async Task AssertHttpProblemAsync(HttpResponseMessage response, HttpStatusCode expectedStatus) =>
        await AssertHttpProblemCoreAsync(response, expectedStatus);

    private static async Task<JsonDocument> AssertHttpProblemCoreAsync(HttpResponseMessage response, HttpStatusCode expectedStatus)
    {
        Assert.Equal(expectedStatus, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.Equal((int)expectedStatus, root.GetProperty("status").GetInt32());
        Assert.True(root.TryGetProperty("title", out _));
        Assert.False(root.TryGetProperty("mensaje", out _));
        return doc;
    }
}
