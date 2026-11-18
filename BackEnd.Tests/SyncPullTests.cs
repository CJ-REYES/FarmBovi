using System.Security.Claims;
using System.Text.Json;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
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
}
