using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
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
        Assert.IsType<BadRequestObjectResult>(selfFather);

        var selfMother = await controller.Registrar(new RegistrarGenealogiaRequest(vaca.IdAnimal, toro.IdAnimal, vaca.IdAnimal), default);
        Assert.IsType<BadRequestObjectResult>(selfMother);

        var sameParents = await controller.Registrar(new RegistrarGenealogiaRequest(toro.IdAnimal, vaca.IdAnimal, vaca.IdAnimal), default);
        Assert.IsType<BadRequestObjectResult>(sameParents);
    }

    [Fact]
    public async Task Registrar_CicloGenealogicoDirectoEIndirecto_Retorna400BadRequest()
    {
        await using var db = CreateInMemoryDb(nameof(Registrar_CicloGenealogicoDirectoEIndirecto_Retorna400BadRequest));
        var (userId, ranchoId, _) = await SeedBaseAsync(db);

        var a = NewAnimal(ranchoId, userId, "A-01");
        var b = NewAnimal(ranchoId, userId, "B-01");
        var c = NewAnimal(ranchoId, userId, "C-01");
        db.Animales.AddRange(a, b, c);
        await db.SaveChangesAsync();

        var controller = CreateController(db, userId);

        // A es padre de B; B es madre de C
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(b.IdAnimal, a.IdAnimal, null), default));
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(c.IdAnimal, null, b.IdAnimal), default));

        // Ciclo directo: B -> A
        var directCycle = await controller.Registrar(new RegistrarGenealogiaRequest(a.IdAnimal, b.IdAnimal, null), default);
        Assert.IsType<BadRequestObjectResult>(directCycle);

        // Ciclo indirecto (3 generaciones): C -> A
        var indirectCycle = await controller.Registrar(new RegistrarGenealogiaRequest(a.IdAnimal, c.IdAnimal, null), default);
        Assert.IsType<BadRequestObjectResult>(indirectCycle);
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
        var obj1 = Assert.IsType<ObjectResult>(forbiddenParent);
        Assert.Equal(StatusCodes.Status403Forbidden, obj1.StatusCode);

        var forbiddenQuery = await controller.ObtenerPadres(animalAjeno.IdAnimal, 1, default);
        var obj2 = Assert.IsType<ObjectResult>(forbiddenQuery);
        Assert.Equal(StatusCodes.Status403Forbidden, obj2.StatusCode);
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

        var updateRes = await controller.Actualizar(cria.IdAnimal, new ActualizarGenealogiaRequest(p2.IdAnimal, m1.IdAnimal, "Corregido"), default);
        var updateOk = Assert.IsType<OkObjectResult>(updateRes);
        var updatedDto = Assert.IsType<GenealogiaRegistroDto>(updateOk.Value);
        Assert.Equal(p2.IdAnimal, updatedDto.IdPadre);
        Assert.Equal(m1.IdAnimal, updatedDto.IdMadre);
        Assert.Equal(2, updatedDto.VersionRegistro);

        Assert.IsType<NoContentResult>(await controller.Eliminar(cria.IdAnimal, default));
        Assert.IsType<CreatedAtActionResult>(await controller.Registrar(new RegistrarGenealogiaRequest(cria.IdAnimal, p1.IdAnimal, m1.IdAnimal), default));
    }
}
