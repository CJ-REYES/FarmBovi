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
using Xunit;

namespace FarmBovi.Tests;

public sealed class EventosReproductivosUnitTests
{
    private static FarmDbContext CreateDb() =>
        new(new DbContextOptionsBuilder<FarmDbContext>()
            .UseInMemoryDatabase($"repro-unit-{Guid.NewGuid():N}")
            .Options);

    private static EventosReproductivosController CreateController(FarmDbContext db, Guid userId)
    {
        var controller = new EventosReproductivosController(db, new FarmDomainValidationService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim("idUsuario", userId.ToString()),
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                    ], "TestJwt"))
                }
            }
        };
        return controller;
    }

    private static async Task<(Guid UserId, Guid RanchA, Guid RanchB, Animal VacaA, Animal ToroA, Animal NovilloA, Animal VacaB, Animal ToroB)>
        SeedScenarioAsync(FarmDbContext db, bool grantBothRanchesToUser = false)
    {
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var ranchA = Guid.NewGuid();
        var ranchB = Guid.NewGuid();

        db.Usuarios.AddRange(
            new Usuario { IdUsuario = userId, Nombre = "Vet A", Correo = "veta@farmbovi.test", Contrasena = "h", Estado = "Activo" },
            new Usuario { IdUsuario = otherUserId, Nombre = "Vet B", Correo = "vetb@farmbovi.test", Contrasena = "h", Estado = "Activo" });

        db.Ranchos.AddRange(
            new Rancho { IdRancho = ranchA, Nombre = "Rancho Norte", UbicacionGeneral = "Sonora", Estado = "Activo", IdAutor = userId },
            new Rancho { IdRancho = ranchB, Nombre = "Rancho Sur", UbicacionGeneral = "Chiapas", Estado = "Activo", IdAutor = otherUserId });

        db.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = userId, IdRancho = ranchA, Rol = "Administrador", Estado = "Activo" });
        db.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = otherUserId, IdRancho = ranchB, Rol = "Administrador", Estado = "Activo" });
        if (grantBothRanchesToUser)
            db.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = userId, IdRancho = ranchB, Rol = "Administrador", Estado = "Activo" });

        var vacaA = new Animal
        {
            IdAnimal = Guid.NewGuid(),
            IdRancho = ranchA,
            Arete = "VA-101",
            Raza = "Holstein",
            Sexo = "Hembra",
            FechaNacimiento = new DateTime(2022, 1, 15, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = userId
        };

        var toroA = new Animal
        {
            IdAnimal = Guid.NewGuid(),
            IdRancho = ranchA,
            Arete = "TA-201",
            Raza = "Brahman",
            Sexo = "Macho",
            FechaNacimiento = new DateTime(2021, 6, 10, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = userId
        };

        var novilloA = new Animal
        {
            IdAnimal = Guid.NewGuid(),
            IdRancho = ranchA,
            Arete = "NA-301",
            Raza = "Angus",
            Sexo = "Macho",
            FechaNacimiento = new DateTime(2023, 3, 1, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = userId
        };

        var vacaB = new Animal
        {
            IdAnimal = Guid.NewGuid(),
            IdRancho = ranchB,
            Arete = "VB-101",
            Raza = "Gyr",
            Sexo = "Hembra",
            FechaNacimiento = new DateTime(2022, 5, 1, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = otherUserId
        };

        var toroB = new Animal
        {
            IdAnimal = Guid.NewGuid(),
            IdRancho = ranchB,
            Arete = "TB-201",
            Raza = "Gyr",
            Sexo = "Macho",
            FechaNacimiento = new DateTime(2021, 5, 1, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = otherUserId
        };

        db.Animales.AddRange(vacaA, toroA, novilloA, vacaB, toroB);
        await db.SaveChangesAsync();

        return (userId, ranchA, ranchB, vacaA, toroA, novilloA, vacaB, toroB);
    }

    [Fact]
    public async Task CicloReproductivoCompleto_RegistraTodosLosTiposDeDominio_YEmiteCambiosServidor()
    {
        await using var db = CreateDb();
        var (userId, ranchA, _, vacaA, toroA, _, _, _) = await SeedScenarioAsync(db);
        var access = new RanchAccessService(db);
        var controller = CreateController(db, userId);

        var eventosDominio = new (string Tipo, Guid? Semental, DateTime Fecha, string? Resultado, string? Obs)[]
        {
            ("Detección de celo", null, new DateTime(2024, 1, 10, 8, 0, 0, DateTimeKind.Utc), "Celo franco matutino", "Mucosa transparente"),
            ("Servicio o monta", toroA.IdAnimal, new DateTime(2024, 1, 10, 16, 0, 0, DateTimeKind.Utc), "Monta natural efectiva", null),
            ("Inseminación", toroA.IdAnimal, new DateTime(2024, 2, 1, 9, 0, 0, DateTimeKind.Utc), "Pajilla lote B-44", "IA a tiempo fijo"),
            ("Diagnóstico de gestación", null, new DateTime(2024, 3, 15, 10, 0, 0, DateTimeKind.Utc), "Positivo 43 días", "Ultrasonografía"),
            ("Confirmación de gestación", null, new DateTime(2024, 5, 15, 10, 0, 0, DateTimeKind.Utc), "Gestante confirmada", "Palpación rectal"),
            ("Parto", toroA.IdAnimal, new DateTime(2024, 11, 12, 6, 30, 0, DateTimeKind.Utc), "Parto eutócico - cría viva", "Sin retención placentaria"),
            ("Pérdida gestacional", null, new DateTime(2025, 4, 20, 11, 0, 0, DateTimeKind.Utc), "Reabsorción embrionaria", "Revisión veterinaria")
        };

        var creados = new List<EventoReproductivoResponseDto>();
        foreach (var ev in eventosDominio)
        {
            var action = await controller.Create(access, new EventoReproductivoCreateDto
            {
                IdAnimal = vacaA.IdAnimal,
                IdSemental = ev.Semental,
                Tipo = ev.Tipo,
                Fecha = ev.Fecha,
                Resultado = ev.Resultado,
                Observaciones = ev.Obs
            }, CancellationToken.None);

            var created = Assert.IsType<CreatedAtActionResult>(action.Result);
            var dto = Assert.IsType<EventoReproductivoResponseDto>(created.Value);
            Assert.Equal(ev.Tipo, dto.Tipo);
            Assert.Equal(ev.Semental, dto.IdSemental);
            Assert.Equal(1L, dto.VersionRegistro);
            Assert.Null(dto.EliminadoEn);
            creados.Add(dto);
        }

        // Consulta filtrada por animal y rango de fechas
        var listResult = await controller.GetAll(
            access,
            idRancho: ranchA,
            idAnimal: vacaA.IdAnimal,
            tipo: "parto",
            desde: new DateTime(2024, 11, 1, 0, 0, 0, DateTimeKind.Utc),
            hasta: new DateTime(2024, 11, 30, 23, 59, 59, DateTimeKind.Utc),
            incluirEliminados: false,
            ct: CancellationToken.None);

        var okList = Assert.IsType<OkObjectResult>(listResult.Result);
        var items = Assert.IsType<List<EventoReproductivoResponseDto>>(okList.Value);
        Assert.Single(items);
        Assert.Equal("Parto", items[0].Tipo);

        // Actualización e incremento de versión + CambioServidor
        var target = creados[0];
        var updateRes = await controller.Update(target.IdEventoReproductivo, new EventoReproductivoUpdateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = null,
            Tipo = "Detección de celo",
            Fecha = target.Fecha,
            Resultado = "Celo intenso verificado",
            Observaciones = "Actualizado en control",
            VersionRegistro = 1L
        }, CancellationToken.None);
        Assert.IsType<NoContentResult>(updateRes);

        // Eliminación lógica e incremento de versión + CambioServidor (Datos == null)
        var deleteRes = await controller.Delete(target.IdEventoReproductivo, CancellationToken.None);
        Assert.IsType<NoContentResult>(deleteRes);

        var cambiosTarget = await db.CambiosServidor.AsNoTracking()
            .Where(c => c.Entidad == nameof(EventoReproductivo) && c.IdRegistro == target.IdEventoReproductivo)
            .OrderBy(c => c.Version)
            .ToListAsync();

        Assert.Equal(3, cambiosTarget.Count);
        Assert.All(cambiosTarget, c => Assert.Equal(ranchA, c.IdRancho));
        Assert.Equal("Crear", cambiosTarget[0].Operacion);
        Assert.Equal(1L, cambiosTarget[0].Version);
        Assert.NotNull(cambiosTarget[0].Datos);

        Assert.Equal("Actualizar", cambiosTarget[1].Operacion);
        Assert.Equal(2L, cambiosTarget[1].Version);
        Assert.NotNull(cambiosTarget[1].Datos);

        Assert.Equal("Eliminar", cambiosTarget[2].Operacion);
        Assert.Equal(3L, cambiosTarget[2].Version);
        Assert.Null(cambiosTarget[2].Datos);
    }

    [Theory]
    [InlineData("Detección de celo")]
    [InlineData("Inseminación")]
    [InlineData("Diagnóstico de gestación")]
    [InlineData("Confirmación de gestación")]
    [InlineData("Parto")]
    [InlineData("Pérdida gestacional")]
    public async Task ValidacionesBiologicas_EventosExclusivosDeHembraEnMacho_SeRechazanCon400(string tipoEvento)
    {
        await using var db = CreateDb();
        var (userId, _, _, _, _, novilloA, _, _) = await SeedScenarioAsync(db);
        var access = new RanchAccessService(db);
        var controller = CreateController(db, userId);

        var res = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = novilloA.IdAnimal,
            Tipo = tipoEvento,
            Fecha = new DateTime(2024, 6, 10, 12, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);

        var obj = Assert.IsType<BadRequestObjectResult>(res.Result);
        Assert.Equal(StatusCodes.Status400BadRequest, obj.StatusCode);
        Assert.IsType<ValidationProblemDetails>(obj.Value);
    }

    [Fact]
    public async Task ValidacionesRelacionalesYDeFechas_RechazanSementalInvalido_OtroRancho_FechasIncoherentes_YPartosCercanos()
    {
        await using var db = CreateDb();
        // Usuario con acceso a ambos ranchos para comprobar que incluso con permisos no se mezclan animales de distinto rancho
        var (userId, ranchA, _, vacaA, toroA, novilloA, vacaB, toroB) = await SeedScenarioAsync(db, grantBothRanchesToUser: true);
        var access = new RanchAccessService(db);
        var controller = CreateController(db, userId);

        // 1. Semental igual al propio animal -> 400
        var selfSire = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = vacaA.IdAnimal,
            Tipo = "Servicio o monta",
            Fecha = new DateTime(2024, 4, 1, 10, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(selfSire.Result);

        // 2. Semental de sexo Hembra -> 400
        var vacaA2 = new Animal
        {
            IdAnimal = Guid.NewGuid(),
            IdRancho = ranchA,
            Arete = "VA-102",
            Raza = "Holstein",
            Sexo = "Hembra",
            FechaNacimiento = new DateTime(2021, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = userId
        };
        db.Animales.Add(vacaA2);
        await db.SaveChangesAsync();

        var femaleSire = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = vacaA2.IdAnimal,
            Tipo = "Servicio o monta",
            Fecha = new DateTime(2024, 4, 1, 10, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(femaleSire.Result);

        // 3. Animal receptor Macho con IdSemental -> 400
        var maleReceptorWithSire = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = novilloA.IdAnimal,
            IdSemental = toroA.IdAnimal,
            Tipo = "Servicio o monta",
            Fecha = new DateTime(2024, 4, 1, 10, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(maleReceptorWithSire.Result);

        // 4. Semental perteneciente a otro rancho (incluso siendo usuario multi-rancho) -> 400
        var crossRanchSire = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = toroB.IdAnimal,
            Tipo = "Servicio o monta",
            Fecha = new DateTime(2024, 4, 1, 10, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(crossRanchSire.Result);

        // 5. Fecha futura -> 400
        var futureDate = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            Tipo = "Detección de celo",
            Fecha = DateTime.UtcNow.AddDays(3)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(futureDate.Result);

        // 6. Fecha anterior al nacimiento de la hembra (nacida 2022-01-15) -> 400
        var beforeBirth = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            Tipo = "Detección de celo",
            Fecha = new DateTime(2021, 12, 1, 10, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(beforeBirth.Result);

        // 7. Fecha anterior al nacimiento del semental -> 400
        var toroJoven = new Animal
        {
            IdAnimal = Guid.NewGuid(),
            IdRancho = ranchA,
            Arete = "TA-JOVEN",
            Raza = "Brahman",
            Sexo = "Macho",
            FechaNacimiento = new DateTime(2024, 8, 1, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = userId
        };
        db.Animales.Add(toroJoven);
        await db.SaveChangesAsync();

        var beforeSireBirth = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = toroJoven.IdAnimal,
            Tipo = "Servicio o monta",
            Fecha = new DateTime(2024, 5, 1, 10, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(beforeSireBirth.Result);

        // 8. Fecha posterior a FechaSalida del animal -> 400
        vacaB.FechaSalida = new DateTime(2024, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        await db.SaveChangesAsync();

        var afterExit = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaB.IdAnimal,
            Tipo = "Detección de celo",
            Fecha = new DateTime(2024, 3, 15, 10, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(afterExit.Result);

        // 9. Dos partos a menos de 240 días para la misma hembra -> 400; a >= 240 días -> 201 Created
        var firstCalving = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = toroA.IdAnimal,
            Tipo = "Parto",
            Fecha = new DateTime(2023, 10, 1, 8, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);
        var firstCalvingDto = Assert.IsType<EventoReproductivoResponseDto>(
            Assert.IsType<CreatedAtActionResult>(firstCalving.Result).Value);

        var impossibleSecondCalving = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = toroA.IdAnimal,
            Tipo = "Parto",
            Fecha = new DateTime(2024, 1, 15, 8, 0, 0, DateTimeKind.Utc) // 106 días después (< 240)
        }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(impossibleSecondCalving.Result);

        // Actualizar el propio primer parto no debe chocar consigo mismo
        var selfUpdateCalving = await controller.Update(firstCalvingDto.IdEventoReproductivo, new EventoReproductivoUpdateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = toroA.IdAnimal,
            Tipo = "Parto",
            Fecha = new DateTime(2023, 10, 2, 8, 0, 0, DateTimeKind.Utc),
            Resultado = "Parto normal verificado",
            VersionRegistro = 1L
        }, CancellationToken.None);
        Assert.IsType<NoContentResult>(selfUpdateCalving);

        var validSecondCalving = await controller.Create(access, new EventoReproductivoCreateDto
        {
            IdAnimal = vacaA.IdAnimal,
            IdSemental = toroA.IdAnimal,
            Tipo = "Parto",
            Fecha = new DateTime(2024, 9, 15, 8, 0, 0, DateTimeKind.Utc) // > 340 días después
        }, CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(validSecondCalving.Result);

        // 10. Filtro desde > hasta -> 400
        var invalidDateRange = await controller.GetAll(
            access,
            desde: new DateTime(2024, 10, 1, 0, 0, 0, DateTimeKind.Utc),
            hasta: new DateTime(2024, 9, 1, 0, 0, 0, DateTimeKind.Utc),
            ct: CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(invalidDateRange.Result);
    }
}

public sealed class EventosReproductivosHttpIntegrationTests : IAsyncLifetime
{
    private readonly FarmBoviApiFactory _factory = new();
    private readonly Guid _userA = Guid.NewGuid();
    private readonly Guid _userB = Guid.NewGuid();
    private readonly Guid _ranchA = Guid.NewGuid();
    private readonly Guid _ranchB = Guid.NewGuid();
    private readonly Guid _vacaA = Guid.NewGuid();
    private readonly Guid _toroA = Guid.NewGuid();
    private readonly Guid _vacaB = Guid.NewGuid();
    private readonly Guid _toroB = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _factory.SeedAsync(db =>
        {
            db.Usuarios.AddRange(
                new Usuario { IdUsuario = _userA, Nombre = "Admin Rancho A", Correo = "repro-a@farmbovi.test", Contrasena = "h", Estado = "Activo" },
                new Usuario { IdUsuario = _userB, Nombre = "Admin Rancho B", Correo = "repro-b@farmbovi.test", Contrasena = "h", Estado = "Activo" });

            db.Ranchos.AddRange(
                new Rancho { IdRancho = _ranchA, Nombre = "Rancho Repro A", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = _userA },
                new Rancho { IdRancho = _ranchB, Nombre = "Rancho Repro B", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = _userB });

            db.UsuarioRanchos.AddRange(
                new UsuarioRancho { IdUsuario = _userA, IdRancho = _ranchA, Rol = "Administrador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userB, IdRancho = _ranchB, Rol = "Administrador", Estado = "Activo" });

            db.Animales.AddRange(
                new Animal
                {
                    IdAnimal = _vacaA,
                    IdRancho = _ranchA,
                    Arete = "VA-HTTP-1",
                    Raza = "Holstein",
                    Sexo = "Hembra",
                    FechaNacimiento = new DateTime(2021, 3, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userA
                },
                new Animal
                {
                    IdAnimal = _toroA,
                    IdRancho = _ranchA,
                    Arete = "TA-HTTP-1",
                    Raza = "Brahman",
                    Sexo = "Macho",
                    FechaNacimiento = new DateTime(2020, 4, 1, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userA
                },
                new Animal
                {
                    IdAnimal = _vacaB,
                    IdRancho = _ranchB,
                    Arete = "VB-HTTP-1",
                    Raza = "Gyr",
                    Sexo = "Hembra",
                    FechaNacimiento = new DateTime(2021, 5, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userB
                },
                new Animal
                {
                    IdAnimal = _toroB,
                    IdRancho = _ranchB,
                    Arete = "TB-HTTP-1",
                    Raza = "Gyr",
                    Sexo = "Macho",
                    FechaNacimiento = new DateTime(2020, 6, 1, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userB
                });

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
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(id));
        return client;
    }

    [Fact]
    public async Task PipelineHttpReal_CrudIdempotenciaConcurrenciaValidacionesProblemDetails_YAislamientoPorRancho()
    {
        // 1. Sin token -> 401 ProblemDetails
        using var anon = Client();
        var unauthGet = await anon.GetAsync("/api/eventos-reproductivos");
        await AssertProblemAsync(unauthGet, HttpStatusCode.Unauthorized);

        using var clientA = Client(_userA);
        using var clientB = Client(_userB);

        // 2. Validación de DTO en pipeline HTTP -> 400 ValidationProblemDetails
        var badDto = await clientA.PostAsJsonAsync("/api/eventos-reproductivos", new
        {
            idAnimal = Guid.Empty,
            tipo = "   ",
            fecha = "2024-06-01T10:00:00Z",
            observaciones = new string('x', 1001)
        });
        await AssertValidationProblemAsync(badDto);

        // 3. Creación válida con IdEventoReproductivo explícito -> 201 Created + Location
        var eventIdA = Guid.NewGuid();
        var createRes = await clientA.PostAsJsonAsync("/api/eventos-reproductivos", new
        {
            idEventoReproductivo = eventIdA,
            idAnimal = _vacaA,
            idSemental = _toroA,
            tipo = "Inseminación",
            fecha = "2024-06-15T09:30:00Z",
            resultado = "Pajilla Brahman certificada",
            observaciones = "IA primer servicio"
        });
        Assert.Equal(HttpStatusCode.Created, createRes.StatusCode);
        Assert.NotNull(createRes.Headers.Location);
        var createdDto = await createRes.Content.ReadFromJsonAsync<EventoReproductivoResponseDto>();
        Assert.NotNull(createdDto);
        Assert.Equal(eventIdA, createdDto!.IdEventoReproductivo);
        Assert.Equal(1L, createdDto.VersionRegistro);

        // 4. Reintento idempotente con mismo ID y mismo contenido -> 200 OK; contenido distinto -> 409 ProblemDetails
        var retrySame = await clientA.PostAsJsonAsync("/api/eventos-reproductivos", new
        {
            idEventoReproductivo = eventIdA,
            idAnimal = _vacaA,
            idSemental = _toroA,
            tipo = "Inseminación",
            fecha = "2024-06-15T09:30:00Z",
            resultado = "Pajilla Brahman certificada",
            observaciones = "IA primer servicio"
        });
        Assert.Equal(HttpStatusCode.OK, retrySame.StatusCode);

        var retryDiff = await clientA.PostAsJsonAsync("/api/eventos-reproductivos", new
        {
            idEventoReproductivo = eventIdA,
            idAnimal = _vacaA,
            idSemental = _toroA,
            tipo = "Parto",
            fecha = "2024-06-15T09:30:00Z"
        });
        await AssertProblemAsync(retryDiff, HttpStatusCode.Conflict);

        // 5. Aislamiento estricto por rancho: usuario de Rancho B no puede consultar, modificar, eliminar ni referenciar animales/IDs de Rancho A
        await AssertProblemAsync(
            await clientB.GetAsync($"/api/eventos-reproductivos/{eventIdA}"),
            HttpStatusCode.Forbidden);

        await AssertProblemAsync(
            await clientB.GetAsync($"/api/eventos-reproductivos?idRancho={_ranchA}"),
            HttpStatusCode.Forbidden);

        await AssertProblemAsync(
            await clientB.GetAsync($"/api/eventos-reproductivos?idAnimal={_vacaA}"),
            HttpStatusCode.Forbidden);

        await AssertProblemAsync(
            await clientB.PostAsJsonAsync("/api/eventos-reproductivos", new
            {
                idAnimal = _vacaA,
                tipo = "Detección de celo",
                fecha = "2024-06-20T08:00:00Z"
            }),
            HttpStatusCode.Forbidden);

        await AssertProblemAsync(
            await clientB.PostAsJsonAsync("/api/eventos-reproductivos", new
            {
                idAnimal = _vacaB,
                idSemental = _toroA, // Semental de Rancho A
                tipo = "Servicio o monta",
                fecha = "2024-06-20T08:00:00Z"
            }),
            HttpStatusCode.Forbidden);

        await AssertProblemAsync(
            await clientB.PostAsJsonAsync("/api/eventos-reproductivos", new
            {
                idEventoReproductivo = eventIdA, // ID perteneciente a Rancho A
                idAnimal = _vacaB,
                tipo = "Detección de celo",
                fecha = "2024-06-20T08:00:00Z"
            }),
            HttpStatusCode.Forbidden);

        await AssertProblemAsync(
            await clientB.PutAsJsonAsync($"/api/eventos-reproductivos/{eventIdA}", new
            {
                idAnimal = _vacaA,
                tipo = "Inseminación",
                fecha = "2024-06-15T09:30:00Z",
                versionRegistro = 1L
            }),
            HttpStatusCode.Forbidden);

        await AssertProblemAsync(
            await clientB.DeleteAsync($"/api/eventos-reproductivos/{eventIdA}"),
            HttpStatusCode.Forbidden);

        // Listado general de Rancho B no expone registros de Rancho A
        var listB = await clientB.GetFromJsonAsync<List<EventoReproductivoResponseDto>>("/api/eventos-reproductivos");
        Assert.NotNull(listB);
        Assert.Empty(listB!);

        // 6. PUT: cambio de IdAnimal -> 400; EliminadoEn en PUT -> 400; versión obsoleta -> 409; PUT válido -> 204
        await AssertValidationProblemAsync(await clientA.PutAsJsonAsync($"/api/eventos-reproductivos/{eventIdA}", new
        {
            idAnimal = _toroA,
            tipo = "Inseminación",
            fecha = "2024-06-15T09:30:00Z",
            versionRegistro = 1L
        }));

        await AssertValidationProblemAsync(await clientA.PutAsJsonAsync($"/api/eventos-reproductivos/{eventIdA}", new
        {
            idAnimal = _vacaA,
            idSemental = _toroA,
            tipo = "Inseminación",
            fecha = "2024-06-15T09:30:00Z",
            eliminadoEn = "2024-06-16T00:00:00Z",
            versionRegistro = 1L
        }));

        await AssertProblemAsync(await clientA.PutAsJsonAsync($"/api/eventos-reproductivos/{eventIdA}", new
        {
            idAnimal = _vacaA,
            idSemental = _toroA,
            tipo = "Inseminación",
            fecha = "2024-06-15T09:30:00Z",
            versionRegistro = 99L
        }), HttpStatusCode.Conflict);

        var okPut = await clientA.PutAsJsonAsync($"/api/eventos-reproductivos/{eventIdA}", new
        {
            idAnimal = _vacaA,
            idSemental = _toroA,
            tipo = "Confirmación de gestación",
            fecha = "2024-08-01T10:00:00Z",
            resultado = "Gestante 47 días",
            observaciones = "Confirmada por ecografía",
            versionRegistro = 1L
        });
        Assert.Equal(HttpStatusCode.NoContent, okPut.StatusCode);

        var afterPut = await clientA.GetFromJsonAsync<EventoReproductivoResponseDto>($"/api/eventos-reproductivos/{eventIdA}");
        Assert.NotNull(afterPut);
        Assert.Equal("Confirmación de gestación", afterPut!.Tipo);
        Assert.Equal(2L, afterPut.VersionRegistro);

        // 7. DELETE lógico -> 204; PUT posterior sobre eliminado -> 409; listado estándar lo omite, incluirEliminados=true lo incluye
        var delRes = await clientA.DeleteAsync($"/api/eventos-reproductivos/{eventIdA}");
        Assert.Equal(HttpStatusCode.NoContent, delRes.StatusCode);

        await AssertProblemAsync(await clientA.PutAsJsonAsync($"/api/eventos-reproductivos/{eventIdA}", new
        {
            idAnimal = _vacaA,
            idSemental = _toroA,
            tipo = "Confirmación de gestación",
            fecha = "2024-08-01T10:00:00Z",
            versionRegistro = 3L
        }), HttpStatusCode.Conflict);

        var activeOnly = await clientA.GetFromJsonAsync<List<EventoReproductivoResponseDto>>("/api/eventos-reproductivos");
        Assert.Empty(activeOnly!);

        var withDeleted = await clientA.GetFromJsonAsync<List<EventoReproductivoResponseDto>>("/api/eventos-reproductivos?incluirEliminados=true");
        Assert.Single(withDeleted!);
        Assert.NotNull(withDeleted![0].EliminadoEn);
    }

    [Fact]
    public async Task SincronizacionPushYPull_EventoReproductivo_MantieneIdempotenciaOrdenTumbasYAislamientoPorRancho()
    {
        using var clientA = Client(_userA);
        using var clientB = Client(_userB);

        var recordId = Guid.NewGuid();
        var opCreate = Guid.NewGuid();

        // 1. Push Crear para EventoReproductivo
        var pushCreate = await clientA.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = opCreate,
            idRancho = _ranchA,
            idDispositivo = "dev-repro-a1",
            entidad = "EventoReproductivo",
            idRegistro = recordId,
            operacion = "Crear",
            datos = new
            {
                idAnimal = _vacaA,
                idSemental = _toroA,
                tipo = "Servicio o monta",
                fecha = "2024-07-10T08:00:00Z",
                resultado = "Monta controlada",
                observaciones = "Corral 2"
            }
        });
        Assert.Equal(HttpStatusCode.Created, pushCreate.StatusCode);

        // Reintento idempotente con mismo idOperacion -> 200 OK con duplicadoIgnorado = true
        var pushCreateRetry = await clientA.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = opCreate,
            idRancho = _ranchA,
            idDispositivo = "dev-repro-a1",
            entidad = "EventoReproductivo",
            idRegistro = recordId,
            operacion = "Crear",
            datos = new
            {
                idAnimal = _vacaA,
                idSemental = _toroA,
                tipo = "Servicio o monta",
                fecha = "2024-07-10T08:00:00Z",
                resultado = "Monta controlada",
                observaciones = "Corral 2"
            }
        });
        Assert.Equal(HttpStatusCode.OK, pushCreateRetry.StatusCode);
        using (var retryDoc = JsonDocument.Parse(await pushCreateRetry.Content.ReadAsStringAsync()))
        {
            Assert.True(retryDoc.RootElement.GetProperty("duplicadoIgnorado").GetBoolean());
        }

        // 2. Pull inicial desde otro dispositivo autorizado del Rancho A -> recibe UPSERT v1
        var pull1Res = await clientA.GetAsync($"/api/sync/cambios?idRancho={_ranchA}&entidad=reproductionRecords&limite=10");
        Assert.Equal(HttpStatusCode.OK, pull1Res.StatusCode);
        var pull1 = await pull1Res.Content.ReadFromJsonAsync<CambiosPullResponse>();
        Assert.NotNull(pull1);
        var item1 = Assert.Single(pull1!.Cambios);
        Assert.Equal("UPSERT", item1.Operacion);
        Assert.Equal(recordId, item1.RemoteId);
        Assert.Equal(1L, item1.VersionServidor);
        Assert.Equal("Servicio o monta", item1.Datos!.Value.GetProperty("tipo").GetString());
        Assert.False(string.IsNullOrWhiteSpace(pull1.SiguienteCursorOpaco));
        var cursor1 = pull1.SiguienteCursorOpaco!;

        // 3. Rancho B no puede hacer Pull de Rancho A (403) y en su propio rancho no ve eventos de A
        var pullForbidden = await clientB.GetAsync($"/api/sync/cambios?idRancho={_ranchA}&entidad=reproductionRecords");
        Assert.Equal(HttpStatusCode.Forbidden, pullForbidden.StatusCode);

        var pullOwnEmpty = await clientB.GetAsync($"/api/sync/cambios?idRancho={_ranchB}&entidad=reproductionRecords");
        Assert.Equal(HttpStatusCode.OK, pullOwnEmpty.StatusCode);
        var pullOwn = await pullOwnEmpty.Content.ReadFromJsonAsync<CambiosPullResponse>();
        Assert.NotNull(pullOwn);
        Assert.Empty(pullOwn!.Cambios);

        // 4. Push Actualizar + Push Eliminar -> Pull incremental desde cursor1 devuelve versión posterior y tumba DELETE
        var pushUpdate = await clientA.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = _ranchA,
            idDispositivo = "dev-repro-a1",
            entidad = "reproductionRecords",
            idRegistro = recordId,
            operacion = "Actualizar",
            versionBase = 1L,
            datos = new
            {
                idAnimal = _vacaA,
                idSemental = _toroA,
                tipo = "Diagnóstico de gestación",
                fecha = "2024-08-20T09:00:00Z",
                resultado = "Positivo",
                observaciones = "Ecografía 41d"
            }
        });
        Assert.Equal(HttpStatusCode.OK, pushUpdate.StatusCode);

        var pushDelete = await clientA.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = _ranchA,
            idDispositivo = "dev-repro-a1",
            entidad = "EventoReproductivo",
            idRegistro = recordId,
            operacion = "Eliminar",
            versionBase = 2L
        });
        Assert.Equal(HttpStatusCode.OK, pushDelete.StatusCode);

        var pull2Res = await clientA.GetAsync(
            $"/api/sync/cambios?idRancho={_ranchA}&entidad=reproductionRecords&cursor={Uri.EscapeDataString(cursor1)}&limite=10");
        Assert.Equal(HttpStatusCode.OK, pull2Res.StatusCode);
        var pull2 = await pull2Res.Content.ReadFromJsonAsync<CambiosPullResponse>();
        Assert.NotNull(pull2);
        Assert.Equal(2, pull2!.Cambios.Count);
        Assert.Equal("UPSERT", pull2.Cambios[0].Operacion);
        Assert.Equal(2L, pull2.Cambios[0].VersionServidor);
        Assert.Equal("DELETE", pull2.Cambios[1].Operacion);
        Assert.Equal(3L, pull2.Cambios[1].VersionServidor);
        Assert.True(pull2.Cambios[1].Eliminado);
        Assert.Null(pull2.Cambios[1].Datos);
    }

    private static async Task AssertValidationProblemAsync(HttpResponseMessage response)
    {
        var doc = await AssertProblemCoreAsync(response, HttpStatusCode.BadRequest);
        Assert.True(doc.RootElement.TryGetProperty("errors", out _));
    }

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode expectedStatus) =>
        await AssertProblemCoreAsync(response, expectedStatus);

    private static async Task<JsonDocument> AssertProblemCoreAsync(HttpResponseMessage response, HttpStatusCode expectedStatus)
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
