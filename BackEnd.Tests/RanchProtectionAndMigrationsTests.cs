using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FarmBovi.Tests;

/// <summary>
/// Pruebas de blindaje multi-tenant por rancho (GUID, RanchAccessService, [RanchScope],
/// manipulación de identificadores en query/ruta/body/Sync Push) y verificación del historial
/// y compatibilidad de migraciones EF Core (revisión PR #29).
/// </summary>
public sealed class RanchProtectionAndMigrationsTests : IAsyncLifetime
{
    private static readonly PasswordHasher<Usuario> Hasher = new();
    private readonly FarmBoviApiFactory _factory = new();

    private readonly Guid _adminA = Guid.NewGuid();
    private readonly Guid _workerA = Guid.NewGuid();
    private readonly Guid _adminB = Guid.NewGuid();
    private readonly Guid _ranchlessUser = Guid.NewGuid();

    private readonly Guid _ranchA = Guid.NewGuid();
    private readonly Guid _ranchB = Guid.NewGuid();
    private readonly Guid _loteA = Guid.NewGuid();
    private readonly Guid _loteB = Guid.NewGuid();
    private readonly Guid _animalA = Guid.NewGuid();
    private readonly Guid _animalB = Guid.NewGuid();
    private readonly Guid _eventoA = Guid.NewGuid();
    private readonly Guid _tratamientoA = Guid.NewGuid();
    private readonly Guid _alimentacionA = Guid.NewGuid();
    private readonly Guid _movimientoA = Guid.NewGuid();
    private readonly Guid _recordatorioA = Guid.NewGuid();
    private readonly Guid _membresiaAdminA = Guid.NewGuid();
    private readonly Guid _membresiaWorkerA = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _factory.SeedAsync(db =>
        {
            Usuario User(Guid id, string name)
            {
                var u = new Usuario
                {
                    IdUsuario = id,
                    Nombre = name,
                    Correo = $"{name.ToLowerInvariant()}.{id:N}@farmbovi.test",
                    Estado = "Activo"
                };
                u.Contrasena = Hasher.HashPassword(u, "ClaveSegura123!");
                return u;
            }

            db.Usuarios.AddRange(
                User(_adminA, "AdminA"),
                User(_workerA, "WorkerA"),
                User(_adminB, "AdminB"),
                User(_ranchlessUser, "NuevoSinRancho"));

            db.Ranchos.AddRange(
                new Rancho { IdRancho = _ranchA, Nombre = "Rancho Autorizado A", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = _adminA },
                new Rancho { IdRancho = _ranchB, Nombre = "Rancho Ajeno B", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = _adminB });

            db.UsuarioRanchos.AddRange(
                new UsuarioRancho { IdUsuarioRancho = _membresiaAdminA, IdUsuario = _adminA, IdRancho = _ranchA, Rol = "Admin", Estado = "Activo" },
                new UsuarioRancho { IdUsuarioRancho = _membresiaWorkerA, IdUsuario = _workerA, IdRancho = _ranchA, Rol = "Vaquero", Estado = "Activo" },
                new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = _adminB, IdRancho = _ranchB, Rol = "Admin", Estado = "Activo" });

            db.Lotes.AddRange(
                new Lote { IdLote = _loteA, IdRancho = _ranchA, Nombre = "Potrero A", Estado = "Activo", IdAutor = _adminA },
                new Lote { IdLote = _loteB, IdRancho = _ranchB, Nombre = "Potrero B", Estado = "Activo", IdAutor = _adminB });

            db.Animales.AddRange(
                new Animal
                {
                    IdAnimal = _animalA,
                    IdRancho = _ranchA,
                    IdLote = _loteA,
                    Arete = "RA-100",
                    Raza = "Brahman",
                    Sexo = "Hembra",
                    FechaIngreso = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _adminA
                },
                new Animal
                {
                    IdAnimal = _animalB,
                    IdRancho = _ranchB,
                    IdLote = _loteB,
                    Arete = "RB-200",
                    Raza = "Angus",
                    Sexo = "Macho",
                    FechaIngreso = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _adminB
                });

            db.EventosSanitarios.Add(new EventoSanitario
            {
                IdEventoSanitario = _eventoA,
                IdAnimal = _animalA,
                Tipo = "Vacunación",
                Fecha = new DateTime(2026, 5, 2, 10, 0, 0, DateTimeKind.Utc),
                Responsable = "MVZ A",
                IdAutor = _adminA
            });

            db.Tratamientos.Add(new Tratamiento
            {
                IdTratamiento = _tratamientoA,
                IdEventoSanitario = _eventoA,
                Producto = "Ivermectina",
                Dosis = 5m,
                UnidadDosis = "mL",
                Frecuencia = "Única",
                FechaInicio = new DateTime(2026, 5, 2, 11, 0, 0, DateTimeKind.Utc),
                Responsable = "MVZ A",
                Estado = "Activo",
                IdAutor = _adminA
            });

            db.Alimentaciones.Add(new Alimentacion
            {
                IdAlimentacion = _alimentacionA,
                IdAnimal = _animalA,
                Alimento = "Silo de maíz",
                Racion = "Ración A",
                Cantidad = 12.5m,
                Unidad = "kg",
                Frecuencia = "Diaria",
                Inicio = new DateTime(2026, 5, 3, 8, 0, 0, DateTimeKind.Utc),
                IdAutor = _adminA
            });

            db.MovimientosAnimales.Add(new MovimientoAnimal
            {
                IdMovimiento = _movimientoA,
                IdAnimal = _animalA,
                IdLoteOrigen = null,
                IdLoteDestino = _loteA,
                Tipo = "Alta",
                Fecha = new DateTime(2026, 5, 1, 8, 0, 0, DateTimeKind.Utc),
                Motivo = "Ingreso",
                IdAutor = _adminA
            });

            db.Recordatorios.Add(new Recordatorio
            {
                IdRecordatorio = _recordatorioA,
                IdRancho = _ranchA,
                IdAnimal = _animalA,
                Tipo = "Sanitario",
                Descripcion = "Revisión A",
                FechaProgramada = new DateTime(2026, 6, 1, 8, 0, 0, DateTimeKind.Utc),
                Estado = "Pendiente",
                IdAutor = _adminA
            });

            return Task.CompletedTask;
        });
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private HttpClient Client(Guid userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(userId));
        return client;
    }

    [Fact]
    public async Task AccesoPermitidoAlRanchoAutorizado_ListaConsultaCreaModificaYElimina()
    {
        var clientA = Client(_adminA);

        // Listado con filtro explícito de rancho autorizado -> 200 OK solo con datos de Rancho A
        var animals = await clientA.GetFromJsonAsync<List<AnimalResponseDto>>($"/api/animales?idRancho={_ranchA}");
        Assert.NotNull(animals);
        Assert.Single(animals!);
        Assert.Equal(_animalA, animals[0].IdAnimal);

        var feedings = await clientA.GetFromJsonAsync<List<AlimentacionResponseDto>>($"/api/alimentacion?idRancho={_ranchA}");
        Assert.NotNull(feedings);
        Assert.Single(feedings!);
        Assert.Equal(_alimentacionA, feedings[0].IdAlimentacion);

        // Consulta por ID autorizado -> 200 OK
        Assert.Equal(HttpStatusCode.OK, (await clientA.GetAsync($"/api/alimentacion/{_alimentacionA}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await clientA.GetAsync($"/api/tratamientos/{_tratamientoA}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await clientA.GetAsync($"/api/movimientos-animales/{_movimientoA}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await clientA.GetAsync($"/api/recordatorios/{_recordatorioA}")).StatusCode);

        // Crear, modificar y eliminar en rancho autorizado -> 201, 204, 204
        var newFeedId = Guid.NewGuid();
        var createRes = await clientA.PostAsJsonAsync("/api/alimentacion", new
        {
            idAlimentacion = newFeedId,
            idLote = _loteA,
            alimento = "Alfalfa",
            racion = "Mañana",
            cantidad = 25m,
            unidad = "kg",
            frecuencia = "Diaria",
            inicio = "2026-05-10T08:00:00Z"
        });
        Assert.Equal(HttpStatusCode.Created, createRes.StatusCode);

        var updateRes = await clientA.PutAsJsonAsync($"/api/alimentacion/{newFeedId}", new
        {
            idLote = _loteA,
            alimento = "Alfalfa henificada",
            racion = "Mañana",
            cantidad = 30m,
            unidad = "kg",
            frecuencia = "Diaria",
            inicio = "2026-05-10T08:00:00Z"
        });
        Assert.Equal(HttpStatusCode.NoContent, updateRes.StatusCode);

        var deleteRes = await clientA.DeleteAsync($"/api/alimentacion/{newFeedId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);
    }

    [Fact]
    public async Task AccesoDenegadoAOtroRancho_QueryParamYRutaPorIdentificador()
    {
        var clientB = Client(_adminB);

        // Manipulación de ?idRancho=<ranchoAjeno> en todos los listados -> 403 Forbidden
        var listEndpoints = new[]
        {
            $"/api/animales?idRancho={_ranchA}",
            $"/api/lotes?idRancho={_ranchA}",
            $"/api/alimentacion?idRancho={_ranchA}",
            $"/api/movimientos-animales?idRancho={_ranchA}",
            $"/api/eventos-sanitarios?idRancho={_ranchA}",
            $"/api/tratamientos?idRancho={_ranchA}",
            $"/api/recordatorios?idRancho={_ranchA}",
            $"/api/animales?idRancho={Guid.NewGuid()}" // rancho inexistente tampoco debe autorizarse
        };
        foreach (var url in listEndpoints)
        {
            var res = await clientB.GetAsync(url);
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        }

        // Consultas directas por ID de registros de Rancho A -> 403 Forbidden
        var byIdEndpoints = new[]
        {
            $"/api/ranchos/{_ranchA}",
            $"/api/lotes/{_loteA}",
            $"/api/animales/{_animalA}",
            $"/api/alimentacion/{_alimentacionA}",
            $"/api/movimientos-animales/{_movimientoA}",
            $"/api/eventos-sanitarios/{_eventoA}",
            $"/api/tratamientos/{_tratamientoA}",
            $"/api/recordatorios/{_recordatorioA}",
            $"/api/usuario-ranchos/{_membresiaAdminA}"
        };
        foreach (var url in byIdEndpoints)
        {
            var res = await clientB.GetAsync(url);
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        }

        // Miembro no-admin de Rancho A no puede consultar la membresía de otro miembro manipulando el ID
        var workerClient = Client(_workerA);
        Assert.Equal(HttpStatusCode.OK, (await workerClient.GetAsync($"/api/usuario-ranchos/{_membresiaWorkerA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await workerClient.GetAsync($"/api/usuario-ranchos/{_membresiaAdminA}")).StatusCode);

        // Un admin de Rancho B NO puede leer, modificar ni eliminar a un usuario sin ranchos
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.GetAsync($"/api/usuarios/{_ranchlessUser}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PutAsJsonAsync($"/api/usuarios/{_ranchlessUser}", new
        {
            nombre = "Secuestrado",
            correo = "secuestrado@farmbovi.test",
            estado = "Inactivo"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.DeleteAsync($"/api/usuarios/{_ranchlessUser}")).StatusCode);
    }

    [Fact]
    public async Task ProteccionDeCreacionModificacionYEliminacion_EnRestYSyncPush()
    {
        var clientB = Client(_adminB);

        // POST intentando crear recursos en Rancho A -> 403 Forbidden
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PostAsJsonAsync("/api/alimentacion", new
        {
            idAnimal = _animalA,
            alimento = "Forraje",
            racion = "R",
            cantidad = 5m,
            unidad = "kg",
            frecuencia = "Diaria",
            inicio = "2026-05-10T08:00:00Z"
        })).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PostAsJsonAsync("/api/movimientos-animales", new
        {
            idAnimal = _animalB,
            idLoteOrigen = _loteA, // lote de otro rancho inyectado en movimiento propio
            tipo = "CambioInterno",
            fecha = "2026-05-10T08:00:00Z"
        })).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PostAsJsonAsync("/api/tratamientos", new
        {
            idEventoSanitario = _eventoA,
            producto = "Med",
            dosis = 2m,
            unidadDosis = "mL",
            frecuencia = "Única",
            fechaInicio = "2026-05-10T08:00:00Z",
            responsable = "X",
            estado = "Activo"
        })).StatusCode);

        // Recordatorio con responsable perteneciente a otro rancho -> 400 ValidationProblemDetails
        var badRespRes = await clientB.PostAsJsonAsync("/api/recordatorios", new
        {
            idRancho = _ranchB,
            idResponsable = _adminA,
            tipo = "General",
            descripcion = "Asignar a ajeno",
            fechaProgramada = "2026-06-10T08:00:00Z",
            estado = "Pendiente"
        });
        Assert.Equal(HttpStatusCode.BadRequest, badRespRes.StatusCode);

        // PUT y DELETE sobre registros de Rancho A -> 403 Forbidden
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PutAsJsonAsync($"/api/alimentacion/{_alimentacionA}", new
        {
            idAnimal = _animalB,
            alimento = "Hack",
            racion = "R",
            cantidad = 5m,
            unidad = "kg",
            frecuencia = "Diaria",
            inicio = "2026-05-10T08:00:00Z"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.DeleteAsync($"/api/alimentacion/{_alimentacionA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.DeleteAsync($"/api/tratamientos/{_tratamientoA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.DeleteAsync($"/api/recordatorios/{_recordatorioA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.DeleteAsync($"/api/movimientos-animales/{_movimientoA}")).StatusCode);

        // Sync Push: inyección de FK de Rancho A dentro de Recordatorio de Rancho B -> 403 Forbidden
        var pushRecInjection = await clientB.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = _ranchB,
            idDispositivo = "dev-sec-1",
            entidad = "Recordatorio",
            idRegistro = Guid.NewGuid(),
            operacion = "Crear",
            payload = new
            {
                idRancho = _ranchB,
                idAnimal = _animalA, // animal ajeno!
                tipo = "Sanitario",
                descripcion = "FK cross-ranch",
                fechaProgramada = "2026-06-15T10:00:00Z",
                estado = "Pendiente"
            }
        });
        Assert.Equal(HttpStatusCode.Forbidden, pushRecInjection.StatusCode);

        // Sync Push: inyección de IdLoteDestino ajeno en MovimientoAnimal -> 403 Forbidden
        var pushMovInjection = await clientB.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = _ranchB,
            idDispositivo = "dev-sec-1",
            entidad = "MovimientoAnimal",
            idRegistro = Guid.NewGuid(),
            operacion = "Crear",
            payload = new
            {
                idAnimal = _animalB,
                idLoteOrigen = _loteB,
                idLoteDestino = _loteA, // lote ajeno!
                tipo = "CambioInterno",
                fecha = "2026-05-12T10:00:00Z"
            }
        });
        Assert.Equal(HttpStatusCode.Forbidden, pushMovInjection.StatusCode);

        // Sync Push: miembro no-admin de Rancho A no puede actualizar ni eliminar el Rancho vía Push -> 403
        var workerClient = Client(_workerA);
        var pushRanchEscalation = await workerClient.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = _ranchA,
            idDispositivo = "dev-worker-1",
            entidad = "Rancho",
            idRegistro = _ranchA,
            operacion = "Actualizar",
            versionBase = 1,
            payload = new { nombre = "Rancho Robado" }
        });
        Assert.Equal(HttpStatusCode.Forbidden, pushRanchEscalation.StatusCode);
    }

    [Fact]
    public void Migraciones_ConservanHistorialCompletoGuidSinCambiosPendientesYLockValido()
    {
        // 1. Verificar que el historial incremental completo de 9 migraciones está intacto (sin borrados ni migraciones int)
        var migrationTypes = typeof(FarmDbContext).Assembly.GetTypes()
            .Where(t => typeof(Migration).IsAssignableFrom(t) && !t.IsAbstract)
            .Select(t => t.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(
            [
                "AddArchivoMultimedia",
                "AddBoviScaleMetadataToPesaje",
                "AddEventoReproductivo",
                "AddGenealogiaAnimal",
                "AddPesaje",
                "AddSincronizacionYAuditoriaModels",
                "AddUsuarioPerfilYConfiguracion",
                "EnhanceArchivoMultimediaMetadata",
                "InitialMySqlModels"
            ],
            migrationTypes);

        // 2. Verificar que todas las entidades del modelo EF Core usan Guid en sus claves primarias y FKs sin DeleteBehavior.Cascade
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
        var model = db.Model;

        foreach (var entityType in model.GetEntityTypes())
        {
            var pk = entityType.FindPrimaryKey();
            Assert.NotNull(pk);
            foreach (var pkProp in pk!.Properties)
            {
                Assert.Equal(typeof(Guid), pkProp.ClrType);
            }

            foreach (var fk in entityType.GetForeignKeys())
            {
                Assert.Equal(DeleteBehavior.Restrict, fk.DeleteBehavior);
                foreach (var fkProp in fk.Properties)
                {
                    var underlying = Nullable.GetUnderlyingType(fkProp.ClrType) ?? fkProp.ClrType;
                    Assert.Equal(typeof(Guid), underlying);
                }
            }
        }

        // 3. Verificar que MariaDbCompatibleHistoryRepository valida estrictamente el resultado de GET_LOCK
        MariaDbCompatibleHistoryRepository.EnsureLockAcquired(1);
        MariaDbCompatibleHistoryRepository.EnsureLockAcquired(1L);
        Assert.Throws<InvalidOperationException>(() => MariaDbCompatibleHistoryRepository.EnsureLockAcquired(0));
        Assert.Throws<InvalidOperationException>(() => MariaDbCompatibleHistoryRepository.EnsureLockAcquired(null));
        Assert.Throws<InvalidOperationException>(() => MariaDbCompatibleHistoryRepository.EnsureLockAcquired(DBNull.Value));
    }

    [Fact]
    public async Task RutasCanonicas_SinRutasAlternativasDuplicadas()
    {
        var clientA = Client(_adminA);

        // La ruta canónica /api/alimentacion responde 200 OK
        Assert.Equal(HttpStatusCode.OK, (await clientA.GetAsync("/api/alimentacion")).StatusCode);

        // No se introdujeron rutas alternativas duplicadas (/api/feeding, /api/weights, /api/reproduction)
        Assert.Equal(HttpStatusCode.NotFound, (await clientA.GetAsync("/api/feeding")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await clientA.GetAsync("/api/weights")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await clientA.GetAsync("/api/reproduction")).StatusCode);
    }
}
