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

public sealed class SyncPullTests
{
    private static FarmDbContext CreateDb(string name) => new(
        new DbContextOptionsBuilder<FarmDbContext>()
            .UseInMemoryDatabase(name)
            .Options);

    private static SyncController Controller(FarmDbContext db, Guid userId) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("sub", userId.ToString())
                ], "Bearer"))
            }
        }
    };

    private static async Task<(Guid UserA, Guid UserB, Guid RanchA, Guid RanchB)> SeedAsync(
        FarmDbContext db)
    {
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var ranchA = Guid.NewGuid();
        var ranchB = Guid.NewGuid();
        db.Usuarios.AddRange(
            new Usuario { IdUsuario = userA, Nombre = "A", Correo = $"a-{userA:N}@test.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { IdUsuario = userB, Nombre = "B", Correo = $"b-{userB:N}@test.local", Contrasena = "hash", Estado = "Activo" });
        db.Ranchos.AddRange(
            new Rancho { IdRancho = ranchA, Nombre = "Rancho A", Estado = "Activo", IdAutor = userA },
            new Rancho { IdRancho = ranchB, Nombre = "Rancho B", Estado = "Activo", IdAutor = userB });
        db.UsuarioRanchos.AddRange(
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userA, IdRancho = ranchA, Rol = "Admin", Estado = "Activo" },
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userB, IdRancho = ranchB, Rol = "Admin", Estado = "Activo" });
        await db.SaveChangesAsync();
        db.CambiosServidor.RemoveRange(db.CambiosServidor);
        await db.SaveChangesAsync();
        return (userA, userB, ranchA, ranchB);
    }

    private static CambioServidor Change(Guid ranchId, string entity, Guid recordId, string operation,
        DateTime occurredAt, string? data, Guid? changeId = null) => new()
    {
        IdCambio = changeId ?? Guid.NewGuid(),
        IdRancho = ranchId,
        Entidad = entity,
        IdRegistro = recordId,
        Operacion = operation,
        Version = 1,
        OcurrioEn = occurredAt,
        Origen = "API",
        Datos = data
    };

    private static CambiosPullResponse OkValue(ActionResult<CambiosPullResponse> action)
    {
        var ok = Assert.IsType<OkObjectResult>(action.Result);
        return Assert.IsType<CambiosPullResponse>(ok.Value);
    }

    [Fact]
    public async Task GetCambios_PaginaConCursorOrdenadoYConservaTombstone()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (_, _, ranchId, _) = await SeedAsync(db);
        var timestamp = new DateTime(2026, 11, 17, 10, 0, 0, DateTimeKind.Utc);
        var ids = new[]
        {
            Guid.Parse("10000000-0000-4000-8000-000000000001"),
            Guid.Parse("10000000-0000-4000-8000-000000000002"),
            Guid.Parse("10000000-0000-4000-8000-000000000003")
        };
        db.CambiosServidor.AddRange(
            Change(ranchId, nameof(Animal), ids[2], "Eliminar", timestamp, null, ids[2]),
            Change(ranchId, nameof(Animal), ids[0], "Crear", timestamp, "{\"Arete\":\"A-1\",\"Sexo\":\"Hembra\",\"IdRancho\":\"" + ranchId + "\"}", ids[0]),
            Change(ranchId, nameof(Lote), Guid.NewGuid(), "Crear", timestamp, "{\"Nombre\":\"Otro tipo\"}"),
            Change(Guid.NewGuid(), nameof(Animal), Guid.NewGuid(), "Crear", timestamp, "{}"));
        await db.SaveChangesAsync();

        var controller = Controller(db, db.Usuarios.Single(u => u.Nombre == "A").IdUsuario);
        var first = OkValue(await controller.GetCambios("cattle", null, ranchId, null, null, 1));
        Assert.Equal("cattle", first.Entidad);
        Assert.Single(first.Cambios);
        Assert.Equal(ids[0], first.Cambios[0].RemoteId);
        Assert.Equal("UPSERT", first.Cambios[0].Operacion);
        Assert.True(first.HayMasPaginas);
        Assert.False(string.IsNullOrWhiteSpace(first.SiguienteCursorOpaco));
        Assert.Equal("A-1", first.Cambios[0].Datos!.Value.GetProperty("areteSiniiga").GetString());

        using (var payload = JsonDocument.Parse(JsonSerializer.Serialize(first, new JsonSerializerOptions(JsonSerializerDefaults.Web))))
        {
            Assert.Equal("cattle", payload.RootElement.GetProperty("entidad").GetString());
            Assert.True(payload.RootElement.TryGetProperty("siguienteCursorOpaco", out _));
            Assert.True(payload.RootElement.TryGetProperty("hayMasPaginas", out _));
            Assert.False(payload.RootElement.TryGetProperty("cursorSiguiente", out _));
        }

        var second = OkValue(await controller.GetCambios("cattle", ranchId, null,
            null, first.SiguienteCursorOpaco, 1));
        Assert.Single(second.Cambios);
        Assert.Equal(ids[2], second.Cambios[0].RemoteId);
        Assert.Equal("DELETE", second.Cambios[0].Operacion);
        Assert.True(second.Cambios[0].Eliminado);
        Assert.Null(second.Cambios[0].Datos);
        Assert.False(second.HayMasPaginas);
    }

    [Fact]
    public async Task GetCambios_RechazaRanchoSinMembresiaYCursorMalformado()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (_, userB, ranchA, _) = await SeedAsync(db);
        var controller = Controller(db, userB);

        var forbidden = await controller.GetCambios("cattle", ranchA, null, null, null, 100);
        Assert.IsType<ForbidResult>(forbidden.Result);

        var invalidCursor = await Controller(db, db.Usuarios.First().IdUsuario)
            .GetCambios("cattle", ranchA, null, "no-es-un-cursor", null, 100);
        Assert.IsType<BadRequestObjectResult>(invalidCursor.Result);
    }

    [Fact]
    public async Task GetCambios_ResuelveRanchoCuandoElUsuarioSoloTieneUno()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        var response = OkValue(await Controller(db, userA)
            .GetCambios("lots", null, null, null, null, 100));

        Assert.Equal("lots", response.Entidad);
        Assert.Empty(response.Cambios);
        Assert.False(response.HayMasPaginas);
    }

    [Fact]
    public async Task GetCambios_MapeaTratamientoComoRegistroSanitarioLocal()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        var animalId = Guid.NewGuid();
        var eventId = Guid.NewGuid();
        var treatmentId = Guid.NewGuid();
        db.Animales.Add(new Animal
        {
            IdAnimal = animalId,
            IdRancho = ranchA,
            Arete = "A-2",
            Raza = "Holstein",
            Sexo = "Hembra",
            Procedencia = "Local",
            Estado = "Activo",
            IdAutor = userA
        });
        db.EventosSanitarios.Add(new EventoSanitario
        {
            IdEventoSanitario = eventId,
            IdAnimal = animalId,
            Tipo = "Enfermedad",
            Responsable = "Veterinario",
            IdAutor = userA
        });
        await db.SaveChangesAsync();
        db.CambiosServidor.RemoveRange(db.CambiosServidor);
        await db.SaveChangesAsync();

        db.CambiosServidor.Add(Change(ranchA, nameof(Tratamiento), treatmentId, "Crear",
            DateTime.UtcNow, "{\"IdEventoSanitario\":\"" + eventId + "\",\"Producto\":\"Antibiótico\",\"Dosis\":2,\"UnidadDosis\":\"ml\",\"FechaInicio\":\"2026-11-17T00:00:00Z\"}"));
        await db.SaveChangesAsync();

        var response = OkValue(await Controller(db, userA)
            .GetCambios("healthRecords", ranchA, null, null, null, 100));
        var treatment = Assert.Single(response.Cambios);
        Assert.Equal(treatmentId, treatment.RemoteId);
        Assert.Equal("Tratamiento", treatment.Datos!.Value.GetProperty("tipo").GetString());
        Assert.Equal(animalId, treatment.Datos.Value.GetProperty("cattleId").GetGuid());
        Assert.Equal("Antibiótico 2 ml", treatment.Datos.Value.GetProperty("descripcion").GetString());
    }

    private static string TreatmentJson(Guid eventId) =>
        "{\"IdEventoSanitario\":\"" + eventId + "\",\"Producto\":\"Ivermectina\",\"Dosis\":5,\"UnidadDosis\":\"ml\",\"FechaInicio\":\"2026-11-17T00:00:00Z\"}";

    private static async Task<Guid> SeedHealthEventAsync(FarmDbContext db, Guid userId, Guid ranchId)
    {
        var animalId = Guid.NewGuid();
        var eventId = Guid.NewGuid();
        db.Animales.Add(new Animal { IdAnimal = animalId, IdRancho = ranchId, Arete = "S-" + animalId.ToString("N")[..6], Raza = "R", Sexo = "Hembra", Procedencia = "L", Estado = "Activo", IdAutor = userId });
        db.EventosSanitarios.Add(new EventoSanitario { IdEventoSanitario = eventId, IdAnimal = animalId, Tipo = "Vacuna", Responsable = "MVZ", IdAutor = userId });
        await db.SaveChangesAsync();
        db.CambiosServidor.RemoveRange(db.CambiosServidor);
        await db.SaveChangesAsync();
        return eventId;
    }

    [Fact]
    public async Task GetCambios_FechasIgualesEntrePaginas_NoSaltaNiRepiteRegistros()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        var timestamp = new DateTime(2026, 11, 17, 12, 0, 0, DateTimeKind.Utc);
        var expected = Enumerable.Range(0, 7).Select(_ => Guid.NewGuid()).ToList();
        foreach (var id in expected)
            db.CambiosServidor.Add(Change(ranchA, nameof(Lote), id, "Crear", timestamp, "{\"Nombre\":\"L\"}", id));
        await db.SaveChangesAsync();

        var received = new List<Guid>();
        string? cursor = null;
        for (var i = 0; i < 20; i++)
        {
            var page = OkValue(await Controller(db, userA).GetCambios("lots", ranchA, null, cursor, null, 3));
            received.AddRange(page.Cambios.Select(c => c.RemoteId));
            cursor = page.SiguienteCursorOpaco;
            if (!page.HayMasPaginas) break;
        }

        Assert.Equal(expected.OrderBy(g => g).ToList(), received);

        // Un cambio nuevo con la misma fecha y un IdCambio mayor sigue siendo alcanzable desde el último cursor.
        var later = Guid.Parse("ffffffff-ffff-4fff-bfff-ffffffffffff");
        db.CambiosServidor.Add(Change(ranchA, nameof(Lote), later, "Actualizar", timestamp, "{\"Nombre\":\"L2\"}", later));
        await db.SaveChangesAsync();
        var tail = OkValue(await Controller(db, userA).GetCambios("lots", ranchA, null, cursor, null, 3));
        Assert.Equal(later, Assert.Single(tail.Cambios).RemoteId);
        Assert.Equal("UPSERT", tail.Cambios[0].Operacion);

        // Sin cambios nuevos, el cursor se conserva.
        var empty = OkValue(await Controller(db, userA).GetCambios("lots", ranchA, null, tail.SiguienteCursorOpaco, null, 3));
        Assert.Empty(empty.Cambios);
        Assert.Equal(tail.SiguienteCursorOpaco, empty.SiguienteCursorOpaco);
    }

    [Fact]
    public async Task GetCambios_EliminacionDevuelveDeleteSinDatos()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        var id = Guid.NewGuid();
        var t = DateTime.UtcNow;
        db.CambiosServidor.AddRange(
            Change(ranchA, nameof(Recordatorio), id, "Crear", t, "{\"Tipo\":\"Vacuna\",\"Descripcion\":\"Aplicar\",\"FechaProgramada\":\"2026-12-01T00:00:00Z\",\"Estado\":\"Pendiente\"}"),
            Change(ranchA, nameof(Recordatorio), id, "Eliminar", t.AddSeconds(1), "{\"Tipo\":\"basura\"}"));
        await db.SaveChangesAsync();

        var response = OkValue(await Controller(db, userA).GetCambios("alerts", ranchA, null, null, null, 10));
        Assert.Equal(2, response.Cambios.Count);
        Assert.Equal("UPSERT", response.Cambios[0].Operacion);
        Assert.False(response.Cambios[0].Eliminado);
        Assert.Equal("Aplicar", response.Cambios[0].Datos!.Value.GetProperty("mensaje").GetString());
        Assert.False(response.Cambios[0].Datos!.Value.GetProperty("leida").GetBoolean());
        Assert.Equal("DELETE", response.Cambios[1].Operacion);
        Assert.True(response.Cambios[1].Eliminado);
        Assert.Null(response.Cambios[1].Datos);
    }

    [Fact]
    public async Task GetCambios_MapeaTodasLasEntidadesRemotasDelAlcance()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        var t = DateTime.UtcNow;
        var animal = Guid.NewGuid();
        var lote = Guid.NewGuid();
        db.CambiosServidor.AddRange(
            Change(ranchA, nameof(Lote), Guid.NewGuid(), "Crear", t, "{\"Nombre\":\"Engorda\",\"Ubicacion\":\"Norte\"}"),
            Change(ranchA, nameof(Alimentacion), Guid.NewGuid(), "Crear", t, "{\"Alimento\":\"Maíz\",\"Cantidad\":12.5,\"Inicio\":\"2026-11-17T00:00:00Z\",\"IdLote\":\"" + lote + "\"}"),
            Change(ranchA, nameof(MovimientoAnimal), Guid.NewGuid(), "Crear", t, "{\"IdAnimal\":\"" + animal + "\",\"Fecha\":\"2026-11-17T00:00:00Z\",\"Motivo\":\"Venta\",\"IdLoteOrigen\":\"" + lote + "\"}"),
            Change(ranchA, nameof(EventoSanitario), Guid.NewGuid(), "Crear", t, "{\"IdAnimal\":\"" + animal + "\",\"Tipo\":\"Enfermedad\",\"Diagnostico\":\"Neumonía\",\"Fecha\":\"2026-11-17T00:00:00Z\"}"));
        await db.SaveChangesAsync();

        var lots = OkValue(await Controller(db, userA).GetCambios("lots", ranchA, null, null, null, 10));
        Assert.Equal("Engorda", Assert.Single(lots.Cambios).Datos!.Value.GetProperty("nombre").GetString());
        Assert.Equal("Norte", lots.Cambios[0].Datos!.Value.GetProperty("ubicacion").GetString());

        var feeding = OkValue(await Controller(db, userA).GetCambios("feedingRecords", ranchA, null, null, null, 10));
        var feed = Assert.Single(feeding.Cambios).Datos!.Value;
        Assert.Equal("Maíz", feed.GetProperty("tipoAlimento").GetString());
        Assert.Equal(12.5m, feed.GetProperty("cantidadKg").GetDecimal());
        Assert.Equal(lote, feed.GetProperty("lotId").GetGuid());

        var movements = OkValue(await Controller(db, userA).GetCambios("movements", ranchA, null, null, null, 10));
        var move = Assert.Single(movements.Cambios).Datos!.Value;
        Assert.Equal(animal, move.GetProperty("cattleId").GetGuid());
        Assert.Equal("Venta", move.GetProperty("motivo").GetString());
        Assert.Equal(lote, move.GetProperty("origenLotId").GetGuid());

        var health = OkValue(await Controller(db, userA).GetCambios("healthRecords", ranchA, null, null, null, 10));
        var record = Assert.Single(health.Cambios).Datos!.Value;
        Assert.Equal(animal, record.GetProperty("cattleId").GetGuid());
        Assert.Equal("Neumonía", record.GetProperty("descripcion").GetString());
    }

    [Fact]
    public async Task GetCambios_EntidadesSinModeloRemoto_SeRechazan()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        foreach (var entity in new[] { "genealogy", "reproductionRecords", "media" })
        {
            var result = await Controller(db, userA).GetCambios(entity, ranchA, null, null, null, 10);
            Assert.IsType<BadRequestObjectResult>(result.Result);
        }
    }

    [Fact]
    public async Task GetCambios_TratamientoSinEventoSanitario_NoEntregaUpsertNuloNiAvanzaCursor()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        var t = new DateTime(2026, 11, 17, 8, 0, 0, DateTimeKind.Utc);
        var orphan = Guid.NewGuid();
        db.CambiosServidor.Add(Change(ranchA, nameof(Tratamiento), orphan, "Crear", t, TreatmentJson(Guid.NewGuid())));
        await db.SaveChangesAsync();

        var result = await Controller(db, userA).GetCambios("healthRecords", ranchA, null, null, null, 10);
        var error = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var payload = Assert.IsType<PullErrorResponse>(error.Value);
        Assert.Equal("REFERENCIA_INEXISTENTE", payload.Codigo);
        Assert.Equal(orphan, payload.RemoteId);
        Assert.Null(payload.CursorVigente);
    }

    [Fact]
    public async Task GetCambios_ErrorTrasCambiosValidos_CortaPaginaYRecuperaAlCorregirse()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        var eventId = await SeedHealthEventAsync(db, userA, ranchA);
        var missingEvent = Guid.NewGuid();
        var t = new DateTime(2026, 11, 17, 8, 0, 0, DateTimeKind.Utc);
        var ok1 = Guid.NewGuid();
        var broken = Guid.NewGuid();
        var ok2 = Guid.NewGuid();
        db.CambiosServidor.AddRange(
            Change(ranchA, nameof(Tratamiento), ok1, "Crear", t, TreatmentJson(eventId)),
            Change(ranchA, nameof(Tratamiento), broken, "Crear", t.AddSeconds(1), TreatmentJson(missingEvent)),
            Change(ranchA, nameof(Tratamiento), ok2, "Crear", t.AddSeconds(2), TreatmentJson(eventId)));
        await db.SaveChangesAsync();

        // 1. Se entrega solo lo previo al error; el cursor apunta al último cambio entregado.
        var first = OkValue(await Controller(db, userA).GetCambios("healthRecords", ranchA, null, null, null, 10));
        Assert.Equal(ok1, Assert.Single(first.Cambios).RemoteId);
        Assert.True(first.HayMasPaginas);
        Assert.All(first.Cambios, c => Assert.NotNull(c.Datos));

        // 2. Reintentar desde ese cursor devuelve 422 con el mismo cursor (no avanza).
        var blocked = await Controller(db, userA).GetCambios("healthRecords", ranchA, null, null, first.SiguienteCursorOpaco, 10);
        var error = Assert.IsType<PullErrorResponse>(Assert.IsType<UnprocessableEntityObjectResult>(blocked.Result).Value);
        Assert.Equal(broken, error.RemoteId);
        Assert.Equal(first.SiguienteCursorOpaco, error.CursorVigente);

        // 3. Al corregirse la referencia en el servidor, el mismo cursor recupera todo sin saltos.
        var animalId = db.EventosSanitarios.Single(e => e.IdEventoSanitario == eventId).IdAnimal;
        db.EventosSanitarios.Add(new EventoSanitario { IdEventoSanitario = missingEvent, IdAnimal = animalId, Tipo = "Vacuna", Responsable = "MVZ", IdAutor = userA });
        await db.SaveChangesAsync();
        var recovered = OkValue(await Controller(db, userA).GetCambios("healthRecords", ranchA, null, null, first.SiguienteCursorOpaco, 10));
        Assert.Equal(new[] { broken, ok2 }, recovered.Cambios.Where(c => c.RemoteId == broken || c.RemoteId == ok2).Select(c => c.RemoteId));
        Assert.All(recovered.Cambios, c => Assert.NotNull(c.Datos));
    }

    [Theory]
    [InlineData("Crear", "{no-es-json")]
    [InlineData("Crear", null)]
    [InlineData("Fusionar", "{\"Nombre\":\"L\"}")]
    public async Task GetCambios_DatosInvalidosUOperacionDesconocida_Devuelven422(string operation, string? data)
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);
        db.CambiosServidor.Add(Change(ranchA, nameof(Lote), Guid.NewGuid(), operation, DateTime.UtcNow, data));
        await db.SaveChangesAsync();

        var result = await Controller(db, userA).GetCambios("lots", ranchA, null, null, null, 10);
        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
    }

    [Fact]
    public async Task SyncPushYPull_Pesaje_CreaActualizaEliminaYEntregaCambiosPorRancho()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _) = await SeedAsync(db);

        var animalId = Guid.NewGuid();
        db.Animales.Add(new Animal
        {
            IdAnimal = animalId,
            IdRancho = ranchA,
            Arete = "PES-001",
            Raza = "Indubrasil",
            Sexo = "Hembra",
            FechaIngreso = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc),
            Procedencia = "Propio",
            Estado = "Activo",
            IdAutor = userA
        });
        await db.SaveChangesAsync();

        var pushController = new SincronizacionController(db)
        {
            ControllerContext = Controller(db, userA).ControllerContext
        };

        var weighingId = Guid.NewGuid();
        var createPayload = JsonSerializer.SerializeToElement(new
        {
            idPesaje = weighingId,
            idAnimal = animalId,
            pesoRealKg = 325.5m,
            fecha = "2026-11-22T16:13:58Z",
            fuenteBascula = "Báscula digital corral principal",
            responsable = "Carlos Reyes",
            observaciones = "Pesaje oficial en ayuno"
        });

        var createResult = await pushController.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchA,
            IdDispositivo = "pwa-test-device",
            Entidad = "Pesaje",
            IdRegistro = weighingId,
            Operacion = "Crear",
            Datos = createPayload
        }, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(createResult);
        var saved = await db.Pesajes.AsNoTracking().SingleAsync(p => p.IdPesaje == weighingId);
        Assert.Equal(325.5m, saved.PesoRealKg);
        Assert.Equal(animalId, saved.IdAnimal);
        Assert.Equal(1, saved.VersionRegistro);

        var updatePayload = JsonSerializer.SerializeToElement(new
        {
            pesoRealKg = 330.0m,
            observaciones = "Ajuste por calibración"
        });

        var updateResult = await pushController.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchA,
            IdDispositivo = "pwa-test-device",
            Entidad = "weighings",
            IdRegistro = weighingId,
            Operacion = "Actualizar",
            VersionBase = 1,
            Datos = updatePayload
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updateResult);
        var updated = await db.Pesajes.AsNoTracking().SingleAsync(p => p.IdPesaje == weighingId);
        Assert.Equal(330.0m, updated.PesoRealKg);
        Assert.Equal(2, updated.VersionRegistro);

        var pull = OkValue(await Controller(db, userA).GetCambios("weighings", ranchA, null, null, null, 20));
        Assert.Equal("weighings", pull.Entidad);
        Assert.True(pull.Cambios.Count >= 2);
        var latest = pull.Cambios.Last();
        Assert.Equal(weighingId, latest.RemoteId);
        Assert.Equal(2, latest.VersionServidor);
        Assert.NotNull(latest.Datos);
        Assert.Equal(330.0m, latest.Datos!.Value.GetProperty("pesoRealKg").GetDecimal());
        Assert.Equal(animalId, latest.Datos!.Value.GetProperty("cattleId").GetGuid());
    }
}
