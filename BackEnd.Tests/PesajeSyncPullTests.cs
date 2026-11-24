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

public sealed class PesajeSyncPullTests
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

    private static SyncController PullController(FarmDbContext db, Guid userId) => new(db)
    {
        ControllerContext = CreateUserContext(userId)
    };

    private static SincronizacionController PushController(FarmDbContext db, Guid userId) => new(db)
    {
        ControllerContext = CreateUserContext(userId)
    };

    private static CambiosPullResponse OkPull(ActionResult<CambiosPullResponse> action)
    {
        var ok = Assert.IsType<OkObjectResult>(action.Result);
        return Assert.IsType<CambiosPullResponse>(ok.Value);
    }

    private static async Task<(Guid UserA, Guid UserB, Guid RanchA, Guid RanchB, Guid AnimalA, Guid AnimalB)> SeedTwoRanchesAsync(
        FarmDbContext db)
    {
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var ranchA = Guid.NewGuid();
        var ranchB = Guid.NewGuid();
        var animalA = Guid.NewGuid();
        var animalB = Guid.NewGuid();

        db.Usuarios.AddRange(
            new Usuario { IdUsuario = userA, Nombre = "Usuario A", Correo = $"a-{userA:N}@test.local", Contrasena = "hash", Estado = "Activo" },
            new Usuario { IdUsuario = userB, Nombre = "Usuario B", Correo = $"b-{userB:N}@test.local", Contrasena = "hash", Estado = "Activo" });

        db.Ranchos.AddRange(
            new Rancho { IdRancho = ranchA, Nombre = "Rancho Norte", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userA },
            new Rancho { IdRancho = ranchB, Nombre = "Rancho Sur", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = userB });

        db.UsuarioRanchos.AddRange(
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userA, IdRancho = ranchA, Rol = "Admin", Estado = "Activo" },
            new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userB, IdRancho = ranchB, Rol = "Admin", Estado = "Activo" });

        db.Animales.AddRange(
            new Animal
            {
                IdAnimal = animalA,
                IdRancho = ranchA,
                Arete = "NORTE-001",
                Raza = "Brahman",
                Sexo = "Macho",
                FechaIngreso = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
                Procedencia = "Propio",
                Estado = "Activo",
                IdAutor = userA
            },
            new Animal
            {
                IdAnimal = animalB,
                IdRancho = ranchB,
                Arete = "SUR-001",
                Raza = "Angus",
                Sexo = "Hembra",
                FechaIngreso = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
                Procedencia = "Propio",
                Estado = "Activo",
                IdAutor = userB
            });

        await db.SaveChangesAsync();
        db.CambiosServidor.RemoveRange(db.CambiosServidor);
        await db.SaveChangesAsync();

        return (userA, userB, ranchA, ranchB, animalA, animalB);
    }

    private static CambioServidor CreateWeighingChange(
        Guid ranchId,
        Guid weighingId,
        string operation,
        DateTime occurredAt,
        string? data,
        long version = 1,
        Guid? changeId = null) => new()
    {
        IdCambio = changeId ?? Guid.NewGuid(),
        IdRancho = ranchId,
        Entidad = nameof(Pesaje),
        IdRegistro = weighingId,
        Operacion = operation,
        Version = version,
        OcurrioEn = occurredAt,
        Origen = "PUSH",
        Datos = data
    };

    [Fact]
    public async Task PullPesaje_DosDispositivos_CrearActualizarEliminar_EntregaContratoCompletoYTombstone()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _, animalA, _) = await SeedTwoRanchesAsync(db);

        // Usuario secundario en el mismo rancho (Dispositivo B)
        var userADeviceB = Guid.NewGuid();
        db.Usuarios.Add(new Usuario
        {
            IdUsuario = userADeviceB,
            Nombre = "Operador B",
            Correo = $"opb-{userADeviceB:N}@test.local",
            Contrasena = "hash",
            Estado = "Activo"
        });
        db.UsuarioRanchos.Add(new UsuarioRancho
        {
            IdUsuarioRancho = Guid.NewGuid(),
            IdUsuario = userADeviceB,
            IdRancho = ranchA,
            Rol = "Operador",
            Estado = "Activo"
        });
        await db.SaveChangesAsync();

        var weighingId = Guid.NewGuid();
        var pushDeviceA = PushController(db, userA);
        var pullDeviceB = PullController(db, userADeviceB);

        // 1. Dispositivo A crea un pesaje nuevo
        var createRes = await pushDeviceA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchA,
            IdDispositivo = "device-a",
            Entidad = "Pesaje",
            IdRegistro = weighingId,
            Operacion = "Crear",
            Datos = JsonSerializer.SerializeToElement(new
            {
                idPesaje = weighingId,
                idAnimal = animalA,
                pesoRealKg = 412.75m,
                fecha = "2026-11-22T09:00:00Z",
                fuenteBascula = "Báscula Tru-Test",
                responsable = "Juan Pérez",
                observaciones = "Ayuno 12h",
                origenPesaje = "manual"
            })
        }, CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(createRes);

        // Dispositivo B hace Pull inicial -> recibe pesaje nuevo con ranchId explícito
        var pull1 = OkPull(await pullDeviceB.GetCambios("weighings", ranchA, null, null, null, 10));
        Assert.Equal("weighings", pull1.Entidad);
        var createdChange = Assert.Single(pull1.Cambios);
        Assert.Equal(weighingId, createdChange.RemoteId);
        Assert.Equal("UPSERT", createdChange.Operacion);
        Assert.False(createdChange.Eliminado);
        Assert.Equal(1, createdChange.VersionServidor);
        Assert.NotNull(createdChange.Datos);

        var d1 = createdChange.Datos!.Value;
        Assert.Equal(ranchA, d1.GetProperty("ranchId").GetGuid());
        Assert.Equal(animalA, d1.GetProperty("idAnimal").GetGuid());
        Assert.Equal(animalA, d1.GetProperty("cattleId").GetGuid());
        Assert.Equal(412.75m, d1.GetProperty("pesoRealKg").GetDecimal());
        Assert.Equal(412.75m, d1.GetProperty("peso").GetDecimal());
        Assert.Equal("Báscula Tru-Test", d1.GetProperty("fuenteBascula").GetString());
        Assert.Equal("Juan Pérez", d1.GetProperty("responsable").GetString());
        Assert.Equal("Ayuno 12h", d1.GetProperty("observaciones").GetString());
        Assert.Equal("manual", d1.GetProperty("origenPesaje").GetString());
        Assert.False(pull1.HayMasPaginas);
        Assert.False(string.IsNullOrWhiteSpace(pull1.SiguienteCursorOpaco));

        // 2. Dispositivo A actualiza peso y limpia observaciones a null
        var updateRes = await pushDeviceA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchA,
            IdDispositivo = "device-a",
            Entidad = "Pesaje",
            IdRegistro = weighingId,
            Operacion = "Actualizar",
            VersionBase = 1,
            Datos = JsonSerializer.SerializeToElement(new
            {
                pesoRealKg = 420.5m,
                observaciones = (string?)null
            })
        }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateRes);

        // Dispositivo B hace Pull incremental desde cursor1 -> recibe solo la actualización (v2)
        var pull2 = OkPull(await pullDeviceB.GetCambios("weighings", ranchA, null, null, pull1.SiguienteCursorOpaco, 10));
        var updatedChange = Assert.Single(pull2.Cambios);
        Assert.Equal(weighingId, updatedChange.RemoteId);
        Assert.Equal("UPSERT", updatedChange.Operacion);
        Assert.Equal(2, updatedChange.VersionServidor);
        Assert.NotNull(updatedChange.Datos);
        Assert.Equal(420.5m, updatedChange.Datos!.Value.GetProperty("pesoRealKg").GetDecimal());
        Assert.Equal(JsonValueKind.Null, updatedChange.Datos!.Value.GetProperty("observaciones").ValueKind);

        // 3. Dispositivo A elimina lógicamente el pesaje
        var deleteRes = await pushDeviceA.RecibirOperacion(new OperacionSyncRequest
        {
            IdOperacion = Guid.NewGuid(),
            IdRancho = ranchA,
            IdDispositivo = "device-a",
            Entidad = "Pesaje",
            IdRegistro = weighingId,
            Operacion = "Eliminar",
            VersionBase = 2,
            Datos = JsonSerializer.SerializeToElement(new { idPesaje = weighingId })
        }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(deleteRes);

        // Verifica que CambioServidor conserva Datos == null para "Eliminar" incluso al leerse de EF Core
        var deleteAuditRow = await db.CambiosServidor.AsNoTracking()
            .SingleAsync(c => c.IdRegistro == weighingId && c.Operacion == "Eliminar");
        Assert.Null(deleteAuditRow.Datos);
        Assert.NotNull(deleteAuditRow.Despues);

        // Dispositivo B hace Pull desde cursor2 -> recibe tombstone DELETE sin datos
        var pull3 = OkPull(await pullDeviceB.GetCambios("weighings", ranchA, null, null, pull2.SiguienteCursorOpaco, 10));
        var deletedChange = Assert.Single(pull3.Cambios);
        Assert.Equal(weighingId, deletedChange.RemoteId);
        Assert.Equal("DELETE", deletedChange.Operacion);
        Assert.True(deletedChange.Eliminado);
        Assert.Equal(3, deletedChange.VersionServidor);
        Assert.Null(deletedChange.Datos);

        // Reintento sin cambios nuevos -> devuelve lista vacía y conserva cursor
        var pull4 = OkPull(await pullDeviceB.GetCambios("weighings", ranchA, null, null, pull3.SiguienteCursorOpaco, 10));
        Assert.Empty(pull4.Cambios);
        Assert.False(pull4.HayMasPaginas);
        Assert.Equal(pull3.SiguienteCursorOpaco, pull4.SiguienteCursorOpaco);
    }

    [Fact]
    public async Task PullPesaje_PaginacionDeterministaConFechasIguales_SinDuplicadosNiSaltos()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, ranchB, animalA, animalB) = await SeedTwoRanchesAsync(db);

        var sameTimestamp = new DateTime(2026, 11, 22, 12, 0, 0, DateTimeKind.Utc);
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid()).ToList();

        foreach (var id in ids)
        {
            db.CambiosServidor.Add(CreateWeighingChange(
                ranchA,
                id,
                "Crear",
                sameTimestamp,
                JsonSerializer.Serialize(new
                {
                    IdAnimal = animalA,
                    PesoRealKg = 300m,
                    Fecha = "2026-11-22T12:00:00Z"
                }),
                version: 1,
                changeId: id));
        }

        // Ruido de otro rancho en la misma marca de tiempo: nunca debe aparecer en Rancho A
        db.CambiosServidor.Add(CreateWeighingChange(
            ranchB,
            Guid.NewGuid(),
            "Crear",
            sameTimestamp,
            JsonSerializer.Serialize(new
            {
                IdAnimal = animalB,
                PesoRealKg = 500m,
                Fecha = "2026-11-22T12:00:00Z"
            })));

        await db.SaveChangesAsync();

        var controller = PullController(db, userA);
        var collected = new List<Guid>();
        string? cursor = null;
        var pageCount = 0;

        for (var guard = 0; guard < 10; guard++)
        {
            var page = OkPull(await controller.GetCambios("weighings", ranchA, null, null, cursor, 2));
            pageCount++;
            collected.AddRange(page.Cambios.Select(c => c.RemoteId));
            cursor = page.SiguienteCursorOpaco;
            if (!page.HayMasPaginas) break;
        }

        Assert.Equal(3, pageCount);
        Assert.Equal(ids.OrderBy(g => g).ToList(), collected);
        Assert.Equal(collected.Count, collected.Distinct().Count());
    }

    [Fact]
    public async Task PullPesaje_AislamientoPorRancho_RechazaUsuarioAjenoYAnimalDeOtroRanchoSinAvanzarCursor()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, userB, ranchA, _, animalA, animalB) = await SeedTwoRanchesAsync(db);

        var t = new DateTime(2026, 11, 22, 14, 0, 0, DateTimeKind.Utc);
        var validId = Guid.NewGuid();
        var crossRanchWeighingId = Guid.NewGuid();

        db.CambiosServidor.AddRange(
            CreateWeighingChange(
                ranchA,
                validId,
                "Crear",
                t,
                JsonSerializer.Serialize(new
                {
                    IdAnimal = animalA,
                    PesoRealKg = 350m,
                    Fecha = "2026-11-22T14:00:00Z"
                })),
            // Registro anómalo en el log de Rancho A apuntando a un animal de Rancho B
            CreateWeighingChange(
                ranchA,
                crossRanchWeighingId,
                "Crear",
                t.AddSeconds(1),
                JsonSerializer.Serialize(new
                {
                    IdAnimal = animalB,
                    PesoRealKg = 360m,
                    Fecha = "2026-11-22T14:00:01Z"
                })));
        await db.SaveChangesAsync();

        // 1. Usuario B no puede hacer Pull del Rancho A
        var forbidden = await PullController(db, userB).GetCambios("weighings", ranchA, null, null, null, 10);
        Assert.IsType<ForbidResult>(forbidden.Result);

        // 2. Usuario A recibe el pesaje válido previo y la página se corta antes del cambio cruzado
        var firstPage = OkPull(await PullController(db, userA).GetCambios("weighings", ranchA, null, null, null, 10));
        var delivered = Assert.Single(firstPage.Cambios);
        Assert.Equal(validId, delivered.RemoteId);
        Assert.True(firstPage.HayMasPaginas);
        Assert.NotNull(firstPage.SiguienteCursorOpaco);

        // 3. Reintentar desde el cursor entregado devuelve 422 REFERENCIA_INEXISTENTE sin avanzar el cursor
        var blocked = await PullController(db, userA)
            .GetCambios("weighings", ranchA, null, null, firstPage.SiguienteCursorOpaco, 10);
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(blocked.Result);
        var error = Assert.IsType<PullErrorResponse>(unprocessable.Value);
        Assert.Equal("REFERENCIA_INEXISTENTE", error.Codigo);
        Assert.Equal(crossRanchWeighingId, error.RemoteId);
        Assert.Equal(firstPage.SiguienteCursorOpaco, error.CursorVigente);
    }

    [Fact]
    public async Task PullPesaje_DeleteConPesajePertenecienteAOtroRancho_RechazaCon422()
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, userB, ranchA, _, _, animalB) = await SeedTwoRanchesAsync(db);

        var weighingFromRanchB = Guid.NewGuid();
        db.Pesajes.Add(new Pesaje
        {
            IdPesaje = weighingFromRanchB,
            IdAnimal = animalB,
            PesoRealKg = 400m,
            Fecha = new DateTime(2026, 11, 22, 15, 0, 0, DateTimeKind.Utc),
            IdAutor = userB
        });
        await db.SaveChangesAsync();
        db.CambiosServidor.RemoveRange(db.CambiosServidor);

        db.CambiosServidor.Add(CreateWeighingChange(
            ranchA,
            weighingFromRanchB,
            "Eliminar",
            new DateTime(2026, 11, 22, 15, 5, 0, DateTimeKind.Utc),
            null,
            version: 2));
        await db.SaveChangesAsync();

        var result = await PullController(db, userA).GetCambios("weighings", ranchA, null, null, null, 10);
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var error = Assert.IsType<PullErrorResponse>(unprocessable.Value);
        Assert.Equal("REFERENCIA_INEXISTENTE", error.Codigo);
        Assert.Equal(weighingFromRanchB, error.RemoteId);
        Assert.Null(error.CursorVigente);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-15.5)]
    public async Task PullPesaje_PesoNoPositivo_Devuelve422SinAvanzarCursor(double invalidWeight)
    {
        await using var db = CreateDb(Guid.NewGuid().ToString("N"));
        var (userA, _, ranchA, _, animalA, _) = await SeedTwoRanchesAsync(db);

        var badId = Guid.NewGuid();
        db.CambiosServidor.Add(CreateWeighingChange(
            ranchA,
            badId,
            "Crear",
            new DateTime(2026, 11, 22, 16, 0, 0, DateTimeKind.Utc),
            JsonSerializer.Serialize(new
            {
                IdAnimal = animalA,
                PesoRealKg = invalidWeight,
                Fecha = "2026-11-22T16:00:00Z"
            })));
        await db.SaveChangesAsync();

        var result = await PullController(db, userA).GetCambios("weighings", ranchA, null, null, null, 10);
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var error = Assert.IsType<PullErrorResponse>(unprocessable.Value);
        Assert.Equal("DATOS_INVALIDOS", error.Codigo);
        Assert.Equal(badId, error.RemoteId);
        Assert.Null(error.CursorVigente);
    }
}
