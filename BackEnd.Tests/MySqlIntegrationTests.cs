using System.IdentityModel.Tokens.Jwt;
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
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.Data.MySqlClient;
using Xunit;

namespace FarmBovi.Tests;

public sealed class MySqlIntegrationFactAttribute : FactAttribute
{
    public MySqlIntegrationFactAttribute()
    {
        var requireRealDb = string.Equals(
            Environment.GetEnvironmentVariable("FARMBOVI_REQUIRE_REAL_DB"),
            "true",
            StringComparison.OrdinalIgnoreCase);

        if (requireRealDb)
            return;

        if (!MySqlTestHelper.CanConnectServer())
        {
            Skip = "Servidor MySQL/MariaDB no disponible en este entorno. Define FARMBOVI_REQUIRE_REAL_DB=true para hacerlo obligatorio.";
        }
    }
}

internal static class MySqlTestHelper
{
    public static string GetBaseConnectionString() =>
        Environment.GetEnvironmentVariable("FARMBOVI_TEST_CONNECTION")
        ?? "Server=localhost;Port=3306;Database=farmbovi;User ID=farmbovi;Password=change_me;";

    public static bool CanConnectServer()
    {
        try
        {
            var builder = new MySqlConnectionStringBuilder(GetBaseConnectionString())
            {
                ConnectionTimeout = 3
            };
            using var conn = new MySqlConnection(builder.ConnectionString);
            conn.Open();
            return true;
        }
        catch
        {
            return false;
        }
    }

    public static FarmDbContext CreateContext(string connectionString) => new(
        new DbContextOptionsBuilder<FarmDbContext>()
            .UseMySQL(connectionString)
            .ReplaceService<IHistoryRepository, MariaDbCompatibleHistoryRepository>()
            .Options);

    /// <summary>Prepara una base temporal aislada y nunca modifica la base configurada.</summary>
    public static async Task<(string ConnectionString, bool IsIsolatedDatabase, string IsolatedDbName)> PrepareCleanDatabaseAsync(string prefix)
    {
        var baseConn = GetBaseConnectionString();
        var isolatedName = $"{prefix}_{Guid.NewGuid():N}"[..32];

        try
        {
            var rootBuilder = new MySqlConnectionStringBuilder(baseConn) { Database = string.Empty };
            await using var conn = new MySqlConnection(rootBuilder.ConnectionString);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DROP DATABASE IF EXISTS `{isolatedName}`; CREATE DATABASE `{isolatedName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
            await cmd.ExecuteNonQueryAsync();

            var isolatedBuilder = new MySqlConnectionStringBuilder(baseConn) { Database = isolatedName };
            return (isolatedBuilder.ConnectionString, true, isolatedName);
        }
        catch (MySqlException ex) when (ex.Number is 1044 or 1045)
        {
            throw new InvalidOperationException(
                "Las pruebas MySQL requieren permiso para crear una base temporal aislada. " +
                "No se modificó la base configurada; concede CREATE/DROP DATABASE o usa una cuenta de pruebas aislada.",
                ex);
        }
    }

    public static async Task CleanupDatabaseAsync(string connectionString, bool isIsolatedDatabase, string databaseName)
    {
        if (isIsolatedDatabase)
        {
            var rootBuilder = new MySqlConnectionStringBuilder(connectionString) { Database = string.Empty };
            await using var conn = new MySqlConnection(rootBuilder.ConnectionString);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DROP DATABASE IF EXISTS `{databaseName}`;";
            await cmd.ExecuteNonQueryAsync();
            return;
        }

        throw new InvalidOperationException("La limpieza de pruebas solo se permite en una base aislada.");
    }
}

[CollectionDefinition("MySqlIntegration", DisableParallelization = true)]
public sealed class MySqlIntegrationCollectionDefinition { }

[Collection("MySqlIntegration")]
public sealed class MySqlIntegrationTests
{
    private static SincronizacionController CreateSyncController(FarmDbContext db) =>
        new(db, new RanchAccessService(db));

    private static void AttachJwtUser(ControllerBase controller, int userId)
    {
        var identity = new ClaimsIdentity(
        [
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(ClaimTypes.NameIdentifier, userId.ToString())
        ], "Bearer");
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
        };
    }

    [MySqlIntegrationFact]
    public async Task MigracionIncremental_BaseNuevaVacia_AplicaLimpiaYEjecutaPushConcurrenteYConcurrenciaOptimista()
    {
        var (connStr, isIsolated, dbName) = await MySqlTestHelper.PrepareCleanDatabaseAsync("fb_fresh");

        try
        {
            await using (var db = MySqlTestHelper.CreateContext(connStr))
            {
                await db.Database.MigrateAsync();
                Assert.False(db.Database.HasPendingModelChanges());
            }

            const int userId = 1;
            var ranchoId = Guid.NewGuid();
            var loteId = Guid.NewGuid();

            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario
                {
                    Id = userId,
                    Nombre = "Roberto",
                    Correo = "roberto.mysql@farmbovi.local",
                    Contrasena = "hash",
                    Estado = "Activo"
                });
                seedDb.Ranchos.Add(new Rancho
                {
                    IdRancho = ranchoId,
                    Nombre = "Rancho MySQL",
                    UbicacionGeneral = "Norte",
                    Estado = "Activo",
                    IdAutor = userId
                });
                seedDb.UsuarioRanchos.Add(new UsuarioRancho
                {
                    IdUsuarioRancho = Guid.NewGuid(),
                    IdUsuario = userId,
                    IdRancho = ranchoId,
                    Rol = "Admin",
                    Estado = "Activo"
                });
                seedDb.Lotes.Add(new Lote
                {
                    IdLote = loteId,
                    IdRancho = ranchoId,
                    Nombre = "Lote MySQL",
                    Estado = "Activo",
                    IdAutor = userId
                });
                await seedDb.SaveChangesAsync();
                seedDb.CambiosServidor.RemoveRange(seedDb.CambiosServidor);
                await seedDb.SaveChangesAsync();
            }

            // Idempotencia concurrente entre dos instancias independientes contra MySQL/MariaDB real
            var opId = Guid.NewGuid();
            var animalId = Guid.NewGuid();
            var payloadA = JsonDocument.Parse($$"""{"idAnimal":"{{animalId}}","idLote":"{{loteId}}","arete":"MYSQL-001","raza":"Brangus","sexo":"Macho","procedencia":"Propio","estado":"Activo"}""").RootElement;
            var payloadB = JsonDocument.Parse($$"""{"estado":"Activo","procedencia":"Propio","sexo":"Macho","raza":"Brangus","arete":"MYSQL-001","idLote":"{{loteId}}","idAnimal":"{{animalId}}"}""").RootElement;

            var dupResults = await Task.WhenAll(
                Task.Run(async () =>
                {
                    await using var db1 = MySqlTestHelper.CreateContext(connStr);
                    var c1 = CreateSyncController(db1);
                    AttachJwtUser(c1, userId);
                    return await c1.RecibirOperacion(new OperacionSyncRequest
                    {
                        IdOperacion = opId,
                        IdRancho = ranchoId,
                        IdDispositivo = "instancia-a",
                        Entidad = "Animal",
                        IdRegistro = animalId,
                        Operacion = "Crear",
                        Payload = payloadA
                    }, default);
                }),
                Task.Run(async () =>
                {
                    await using var db2 = MySqlTestHelper.CreateContext(connStr);
                    var c2 = CreateSyncController(db2);
                    AttachJwtUser(c2, userId);
                    return await c2.RecibirOperacion(new OperacionSyncRequest
                    {
                        IdOperacion = opId,
                        IdRancho = ranchoId,
                        IdDispositivo = "instancia-a",
                        Entidad = "Animal",
                        IdRegistro = animalId,
                        Operacion = "Crear",
                        Payload = payloadB
                    }, default);
                }));

            Assert.All(dupResults, r => Assert.True(r is CreatedAtActionResult or OkObjectResult));
            Assert.Equal(1, dupResults.Count(r => r is OkObjectResult ok && ((OperacionSyncResponse)ok.Value!).DuplicadoIgnorado));

            // Concurrencia optimista real en MySQL/MariaDB con dos instancias simultáneas
            var concResults = await Task.WhenAll(
                Task.Run(async () =>
                {
                    await using var db1 = MySqlTestHelper.CreateContext(connStr);
                    var c1 = CreateSyncController(db1);
                    AttachJwtUser(c1, userId);
                    return await c1.RecibirOperacion(new OperacionSyncRequest
                    {
                        IdOperacion = Guid.NewGuid(),
                        IdRancho = ranchoId,
                        IdDispositivo = "disp-1",
                        Entidad = "Animal",
                        IdRegistro = animalId,
                        Operacion = "Actualizar",
                        VersionBase = 1,
                        Payload = JsonSerializer.SerializeToElement(new { raza = "Nelore" })
                    }, default);
                }),
                Task.Run(async () =>
                {
                    await using var db2 = MySqlTestHelper.CreateContext(connStr);
                    var c2 = CreateSyncController(db2);
                    AttachJwtUser(c2, userId);
                    return await c2.RecibirOperacion(new OperacionSyncRequest
                    {
                        IdOperacion = Guid.NewGuid(),
                        IdRancho = ranchoId,
                        IdDispositivo = "disp-2",
                        Entidad = "Animal",
                        IdRegistro = animalId,
                        Operacion = "Actualizar",
                        VersionBase = 1,
                        Payload = JsonSerializer.SerializeToElement(new { raza = "Charolais" })
                    }, default);
                }));

            Assert.Equal(1, concResults.Count(r => r is OkObjectResult));
            Assert.Equal(1, concResults.Count(r => r is ConflictObjectResult));

            await using var verifyDb = MySqlTestHelper.CreateContext(connStr);
            Assert.Equal(2, await verifyDb.CambiosServidor.CountAsync());
        }
        finally
        {
            await MySqlTestHelper.CleanupDatabaseAsync(connStr, isIsolated, dbName);
        }
    }

    [MySqlIntegrationFact]
    public async Task MigracionIncremental_BaseConDatosPrevios_ConservaDatosYRelaciones()
    {
        var (connStr, isIsolated, dbName) = await MySqlTestHelper.PrepareCleanDatabaseAsync("fb_legacy");

        const int userId = 1;
        var ranchoId = Guid.NewGuid();
        var urId = Guid.NewGuid();
        var loteId = Guid.NewGuid();
        var animalId = Guid.NewGuid();

        try
        {
            // 1. Aplicar migraciones previas a la alineación final del modelo MySQL
            await using (var db = MySqlTestHelper.CreateContext(connStr))
            {
                var migrator = db.GetService<IMigrator>();
                await migrator.MigrateAsync("20261122223621_AddPesaje");
            }

            // 2. Insertar datos reales previos manteniendo relaciones coherentes
            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario
                {
                    Id = userId,
                    Nombre = "Roberto Legacy",
                    Correo = "legacy@farmbovi.local",
                    Contrasena = "hash_legacy",
                    Estado = "Activo"
                });
                seedDb.Ranchos.Add(new Rancho
                {
                    IdRancho = ranchoId,
                    Nombre = "Rancho Legacy",
                    UbicacionGeneral = "Campeche",
                    Estado = "Activo",
                    IdAutor = userId
                });
                seedDb.UsuarioRanchos.Add(new UsuarioRancho
                {
                    IdUsuarioRancho = urId,
                    IdUsuario = userId,
                    IdRancho = ranchoId,
                    Rol = "Admin",
                    Estado = "Activo"
                });
                seedDb.Lotes.Add(new Lote
                {
                    IdLote = loteId,
                    IdRancho = ranchoId,
                    Nombre = "Lote Legacy",
                    Ubicacion = "Zona 1",
                    Estado = "Activo",
                    IdAutor = userId
                });
                seedDb.Animales.Add(new Animal
                {
                    IdAnimal = animalId,
                    IdRancho = ranchoId,
                    IdLote = loteId,
                    Arete = "LEG-001",
                    Raza = "Brahman",
                    Sexo = "Hembra",
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = userId
                });
                await seedDb.SaveChangesAsync();
            }

            // 3. Aplicar la migración incremental hacia el esquema actual
            await using (var db = MySqlTestHelper.CreateContext(connStr))
            {
                await db.Database.MigrateAsync();
            }

            // 4. Verificar que todos los registros y relaciones sobrevivieron
            await using (var verifyDb = MySqlTestHelper.CreateContext(connStr))
            {
                var user = await verifyDb.Usuarios.SingleAsync(u => u.Correo == "legacy@farmbovi.local");
                var rancho = await verifyDb.Ranchos.SingleAsync(r => r.Nombre == "Rancho Legacy");
                var ur = await verifyDb.UsuarioRanchos.SingleAsync();
                var lote = await verifyDb.Lotes.SingleAsync(l => l.Nombre == "Lote Legacy");
                var animal = await verifyDb.Animales.SingleAsync(a => a.Arete == "LEG-001");

                Assert.True(user.Id > 0);
                Assert.Equal(user.Id, rancho.IdAutor);
                Assert.Equal(user.Id, ur.IdUsuario);
                Assert.Equal(rancho.IdRancho, ur.IdRancho);
                Assert.Equal(rancho.IdRancho, lote.IdRancho);
                Assert.Equal(rancho.IdRancho, animal.IdRancho);
                Assert.Equal(lote.IdLote, animal.IdLote);
                Assert.Equal(user.Id, animal.IdAutor);
            }
        }
        finally
        {
            await MySqlTestHelper.CleanupDatabaseAsync(connStr, isIsolated, dbName);
        }
    }

    [MySqlIntegrationFact]
    public async Task RegistroUsuarioConcurrente_IndiceUnicoEvitaDuplicados()
    {
        var (connStr, isIsolated, dbName) = await MySqlTestHelper.PrepareCleanDatabaseAsync("fb_user_unique");
        try
        {
            await using (var db = MySqlTestHelper.CreateContext(connStr))
                await db.Database.MigrateAsync();

            // Crear usuarios requiere un administrador de rancho autenticado.
            const int adminId = 1;
            var ranchId = Guid.NewGuid();
            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario { Id = adminId, Nombre = "Admin", Correo = $"admin-{adminId}@farmbovi.local", Contrasena = "hash", Estado = "Activo" });
                seedDb.Ranchos.Add(new Rancho { IdRancho = ranchId, Nombre = "Rancho", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = adminId });
                seedDb.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = adminId, IdRancho = ranchId, Rol = "Admin", Estado = "Activo" });
                await seedDb.SaveChangesAsync();
            }

            var correo = $"race-{Guid.NewGuid():N}@farmbovi.local";
            async Task<int> CreateAsync(string nombre)
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var controller = new UsuarioController(db, new RanchAccessService(db));
                AttachJwtUser(controller, adminId);
                var result = await controller.Create(
                    new UsuarioRequest(nombre, correo.ToUpperInvariant(), "ClaveSegura123", "Activo"),
                    CancellationToken.None);
                return result.Result switch
                {
                    CreatedAtActionResult => StatusCodes.Status201Created,
                    ConflictObjectResult => StatusCodes.Status409Conflict,
                    _ => throw new InvalidOperationException($"Respuesta de registro inesperada: {result.Result?.GetType().Name}")
                };
            }

            var statuses = await Task.WhenAll(CreateAsync("Usuario A"), CreateAsync("Usuario B"));
            Assert.Contains(StatusCodes.Status201Created, statuses);
            Assert.Contains(StatusCodes.Status409Conflict, statuses);

            await using var verifyDb = MySqlTestHelper.CreateContext(connStr);
            Assert.Equal(1, await verifyDb.Usuarios.CountAsync(u => u.Correo == correo.ToLowerInvariant()));
        }
        finally
        {
            await MySqlTestHelper.CleanupDatabaseAsync(connStr, isIsolated, dbName);
        }
    }

    [MySqlIntegrationFact]
    public async Task Genealogia_PersistenciaIndicesConcurrenciaYSync_EnMySqlReal()
    {
        var (connStr, isIsolated, dbName) = await MySqlTestHelper.PrepareCleanDatabaseAsync("fb_genealogia");
        try
        {
            await using (var db = MySqlTestHelper.CreateContext(connStr))
            {
                await db.Database.MigrateAsync();
                Assert.False(db.Database.HasPendingModelChanges());
            }

            const int userId = 1;
            var ranchId = Guid.NewGuid();
            var padre1Id = Guid.NewGuid();
            var padre2Id = Guid.NewGuid();
            var madreId = Guid.NewGuid();
            var criaId = Guid.NewGuid();

            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario { Id = userId, Nombre = "Prod", Correo = $"g-{userId}-{Guid.NewGuid():N}@farmbovi.local", Contrasena = "h", Estado = "Activo" });
                seedDb.Ranchos.Add(new Rancho { IdRancho = ranchId, Nombre = "Rancho G", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userId });
                seedDb.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = userId, IdRancho = ranchId, Rol = "Administrador", Estado = "Activo" });
                seedDb.Animales.AddRange(
                    new Animal { IdAnimal = padre1Id, IdRancho = ranchId, Arete = "G-P1", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = padre2Id, IdRancho = ranchId, Arete = "G-P2", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = madreId, IdRancho = ranchId, Arete = "G-M1", Raza = "Angus", Sexo = "Hembra", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = criaId, IdRancho = ranchId, Arete = "G-C1", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId });
                await seedDb.SaveChangesAsync();
            }

            // Helper de mapeo HTTP para ProblemDetails y respuestas de GenealogiaController.
            static int ToHttpStatus(IActionResult res) => res switch
            {
                CreatedAtActionResult => StatusCodes.Status201Created,
                OkObjectResult => StatusCodes.Status200OK,
                NoContentResult => StatusCodes.Status204NoContent,
                ObjectResult obj when obj.StatusCode is { } code => code,
                _ => throw new InvalidOperationException($"Respuesta inesperada: {res.GetType().Name}")
            };

            // 1A. Dos inserciones simultáneas con el mismo animal y el MISMO parentesco:
            // una crea (201), la otra responde idempotente (200) sin duplicar fila ni CambioServidor.
            var sameInsertGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var sameInsertArrived = 0;
            async Task<(int Status, Guid IdGenealogia)> ConcurrentSameInsertAsync()
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var controller = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(db, new FarmBovi.Api.Services.RanchAccessService(db)));
                AttachJwtUser(controller, userId);
                if (Interlocked.Increment(ref sameInsertArrived) == 2)
                    sameInsertGate.TrySetResult();
                await sameInsertGate.Task;

                var res = await controller.Registrar(new RegistrarGenealogiaRequest(criaId, padre1Id, madreId, "Mismo"), CancellationToken.None);
                var status = ToHttpStatus(res);
                var dto = Assert.IsType<GenealogiaRegistroDto>(((ObjectResult)res).Value);
                return (status, dto.IdGenealogia);
            }

            var sameResults = await Task.WhenAll(ConcurrentSameInsertAsync(), ConcurrentSameInsertAsync());
            Assert.Contains(sameResults, r => r.Status == StatusCodes.Status201Created);
            Assert.Contains(sameResults, r => r.Status == StatusCodes.Status200OK);
            Assert.Equal(sameResults[0].IdGenealogia, sameResults[1].IdGenealogia);

            await using (var checkDb = MySqlTestHelper.CreateContext(connStr))
            {
                Assert.Equal(1, await checkDb.GenealogiasAnimales.CountAsync(g => g.IdAnimal == criaId));
                Assert.Equal(1, await checkDb.CambiosServidor.CountAsync(c => c.Entidad == nameof(GenealogiaAnimal) && c.IdRegistro == sameResults[0].IdGenealogia));
            }

            // Reintento explícito de POST ya procesado: mismo contenido -> 200 idempotente; contenido distinto -> 409.
            await using (var retryDb = MySqlTestHelper.CreateContext(connStr))
            {
                var c = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(retryDb, new FarmBovi.Api.Services.RanchAccessService(retryDb)));
                AttachJwtUser(c, userId);
                Assert.Equal(StatusCodes.Status200OK, ToHttpStatus(await c.Registrar(new RegistrarGenealogiaRequest(criaId, padre1Id, madreId, "Mismo"), CancellationToken.None)));
                Assert.Equal(StatusCodes.Status409Conflict, ToHttpStatus(await c.Registrar(new RegistrarGenealogiaRequest(criaId, padre2Id, madreId, "Distinto"), CancellationToken.None)));
            }

            // Eliminar (v1 -> v2) y probar reintento idempotente de DELETE + reutilización de registro eliminado (v2 -> v3).
            await using (var delDb = MySqlTestHelper.CreateContext(connStr))
            {
                var c = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(delDb, new FarmBovi.Api.Services.RanchAccessService(delDb)));
                AttachJwtUser(c, userId);
                Assert.Equal(StatusCodes.Status204NoContent, ToHttpStatus(await c.Eliminar(criaId, versionRegistro: 1, CancellationToken.None)));
                // Reintento de DELETE ya procesado desde versión 1 -> 204 idempotente sin nuevo CambioServidor.
                Assert.Equal(StatusCodes.Status204NoContent, ToHttpStatus(await c.Eliminar(criaId, versionRegistro: 1, CancellationToken.None)));
            }

            // 1B. Dos inserciones/reutilizaciones simultáneas con el mismo animal y parentescos DIFERENTES:
            // una aplica (201) y la otra recibe 409 Conflict por conflicto de datos diferentes.
            var diffInsertGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var diffInsertArrived = 0;
            async Task<int> ConcurrentDifferentInsertAsync(Guid padreId, string obs)
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var controller = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(db, new FarmBovi.Api.Services.RanchAccessService(db)));
                AttachJwtUser(controller, userId);
                if (Interlocked.Increment(ref diffInsertArrived) == 2)
                    diffInsertGate.TrySetResult();
                await diffInsertGate.Task;

                return ToHttpStatus(await controller.Registrar(new RegistrarGenealogiaRequest(criaId, padreId, madreId, obs), CancellationToken.None));
            }

            var diffStatuses = await Task.WhenAll(
                ConcurrentDifferentInsertAsync(padre1Id, "Concurrente A"),
                ConcurrentDifferentInsertAsync(padre2Id, "Concurrente B"));
            Assert.Contains(StatusCodes.Status201Created, diffStatuses);
            Assert.Contains(StatusCodes.Status409Conflict, diffStatuses);

            // Confirmar versión resultante tras reactivación (v3) y limpiar antes de pruebas de actualización/eliminación.
            long versionActiva;
            await using (var vDb = MySqlTestHelper.CreateContext(connStr))
            {
                var row = await vDb.GenealogiasAnimales.AsNoTracking().FirstAsync(g => g.IdAnimal == criaId);
                Assert.Null(row.EliminadoEn);
                versionActiva = row.VersionRegistro;
                Assert.Equal(3L, versionActiva);
            }

            // 2. Actualizaciones simultáneas desde dos contextos independientes: una gana (200), otra 409.
            var startSignal = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var arrived = 0;
            async Task<int> ConcurrentUpdateAsync(Guid nuevoPadre, string obs)
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var service = new FarmBovi.Api.Services.GenealogiaService(db, new FarmBovi.Api.Services.RanchAccessService(db));
                if (Interlocked.Increment(ref arrived) == 2)
                    startSignal.TrySetResult();
                await startSignal.Task;
                var res = await service.ActualizarAsync(
                    criaId,
                    new ActualizarGenealogiaRequest(nuevoPadre, madreId, obs, VersionRegistro: versionActiva),
                    userId,
                    CancellationToken.None);
                return res.Status switch
                {
                    FarmBovi.Api.Services.GenealogiaOperationStatus.Success => StatusCodes.Status200OK,
                    FarmBovi.Api.Services.GenealogiaOperationStatus.Conflict => StatusCodes.Status409Conflict,
                    _ => throw new InvalidOperationException($"Estado inesperado: {res.Status} ({res.Error})")
                };
            }

            var updateStatuses = await Task.WhenAll(
                ConcurrentUpdateAsync(padre1Id, "Update A"),
                ConcurrentUpdateAsync(padre2Id, "Update B"));
            Assert.Contains(StatusCodes.Status200OK, updateStatuses);
            Assert.Contains(StatusCodes.Status409Conflict, updateStatuses);

            // Reintento de PUT ya procesado con su versión previa y mismo payload ganador -> 200 idempotente sin incrementar versión.
            await using (var retryPutDb = MySqlTestHelper.CreateContext(connStr))
            {
                var ganador = await retryPutDb.GenealogiasAnimales.AsNoTracking().FirstAsync(g => g.IdAnimal == criaId);
                Assert.Equal(4L, ganador.VersionRegistro);
                var controller = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(retryPutDb, new FarmBovi.Api.Services.RanchAccessService(retryPutDb)));
                AttachJwtUser(controller, userId);
                var retryPutStatus = ToHttpStatus(await controller.Actualizar(
                    criaId,
                    new ActualizarGenealogiaRequest(ganador.IdPadre, ganador.IdMadre, ganador.Observaciones, VersionRegistro: 3),
                    CancellationToken.None));
                Assert.Equal(StatusCodes.Status200OK, retryPutStatus);
                Assert.Equal(4L, (await retryPutDb.GenealogiasAnimales.AsNoTracking().FirstAsync(g => g.IdAnimal == criaId)).VersionRegistro);
            }

            // 3. Eliminación simultánea contra una actualización en dos contextos independientes: uno gana (200 o 204), el otro recibe 409.
            var raceGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var raceArrived = 0;
            async Task<int> RaceUpdateAsync()
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var controller = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(db, new FarmBovi.Api.Services.RanchAccessService(db)));
                AttachJwtUser(controller, userId);
                if (Interlocked.Increment(ref raceArrived) == 2)
                    raceGate.TrySetResult();
                await raceGate.Task;
                return ToHttpStatus(await controller.Actualizar(criaId, new ActualizarGenealogiaRequest(padre2Id, madreId, "Carrera Update vs Delete", VersionRegistro: 4), CancellationToken.None));
            }
            async Task<int> RaceDeleteAsync()
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var controller = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(db, new FarmBovi.Api.Services.RanchAccessService(db)));
                AttachJwtUser(controller, userId);
                if (Interlocked.Increment(ref raceArrived) == 2)
                    raceGate.TrySetResult();
                await raceGate.Task;
                return ToHttpStatus(await controller.Eliminar(criaId, versionRegistro: 4, CancellationToken.None));
            }

            var raceStatuses = await Task.WhenAll(RaceUpdateAsync(), RaceDeleteAsync());
            Assert.Contains(StatusCodes.Status409Conflict, raceStatuses);
            Assert.Contains(raceStatuses, s => s is StatusCodes.Status200OK or StatusCodes.Status204NoContent);

            // 4. Verificar integridad y emisiones de CambioServidor en MySQL real (Crear -> Eliminar -> Actualizar/Reactivar -> Actualizar -> Eliminar/Actualizar).
            await using var verifyDb = MySqlTestHelper.CreateContext(connStr);
            Assert.Equal(1, await verifyDb.GenealogiasAnimales.CountAsync(g => g.IdAnimal == criaId));
            var cambios = await verifyDb.CambiosServidor.AsNoTracking()
                .Where(c => c.Entidad == nameof(GenealogiaAnimal) && c.IdRegistro == sameResults[0].IdGenealogia)
                .OrderBy(c => c.Version)
                .ToListAsync();
            Assert.Equal(5, cambios.Count);
            Assert.Equal(new[] { 1L, 2L, 3L, 4L, 5L }, cambios.Select(c => c.Version).ToArray());
        }
        finally
        {
            await MySqlTestHelper.CleanupDatabaseAsync(connStr, isIsolated, dbName);
        }
    }

    [MySqlIntegrationFact]
    public async Task Genealogia_ConcurrenciaOptimistaReal_DosContextosIndependientes_Retorna409()
    {
        var (connStr, isIsolated, dbName) = await MySqlTestHelper.PrepareCleanDatabaseAsync("fb_gen_occ");
        try
        {
            await using (var db = MySqlTestHelper.CreateContext(connStr))
            {
                await db.Database.MigrateAsync();
                Assert.False(db.Database.HasPendingModelChanges());
            }

            const int userId = 1;
            var ranchId = Guid.NewGuid();
            var padre1Id = Guid.NewGuid();
            var padre2Id = Guid.NewGuid();
            var madreId = Guid.NewGuid();
            var criaId = Guid.NewGuid();

            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario { Id = userId, Nombre = "Prod", Correo = $"occ-{userId}-{Guid.NewGuid():N}@farmbovi.local", Contrasena = "h", Estado = "Activo" });
                seedDb.Ranchos.Add(new Rancho { IdRancho = ranchId, Nombre = "Rancho OCC", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userId });
                seedDb.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = userId, IdRancho = ranchId, Rol = "Administrador", Estado = "Activo" });
                seedDb.Animales.AddRange(
                    new Animal { IdAnimal = padre1Id, IdRancho = ranchId, Arete = "OCC-P1", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = padre2Id, IdRancho = ranchId, Arete = "OCC-P2", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = madreId, IdRancho = ranchId, Arete = "OCC-M1", Raza = "Angus", Sexo = "Hembra", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = criaId, IdRancho = ranchId, Arete = "OCC-C1", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId });
                await seedDb.SaveChangesAsync();

                var seedController = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(seedDb, new FarmBovi.Api.Services.RanchAccessService(seedDb)));
                AttachJwtUser(seedController, userId);
                Assert.IsType<CreatedAtActionResult>(await seedController.Registrar(new RegistrarGenealogiaRequest(criaId, padre1Id, madreId, "Inicial"), CancellationToken.None));
            }

            // 1. Abrir dos contextos independientes y consultar el mismo registro con la misma versión inicial (1).
            await using var db1 = MySqlTestHelper.CreateContext(connStr);
            await using var db2 = MySqlTestHelper.CreateContext(connStr);

            var reg1 = await db1.GenealogiasAnimales.FirstAsync(g => g.IdAnimal == criaId);
            var reg2 = await db2.GenealogiasAnimales.FirstAsync(g => g.IdAnimal == criaId);
            Assert.Equal(1L, reg1.VersionRegistro);
            Assert.Equal(1L, reg2.VersionRegistro);

            // 2. El contexto 1 guarda su modificación (VersionRegistro pasa a 2 en BD).
            var controller1 = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(db1, new FarmBovi.Api.Services.RanchAccessService(db1)));
            AttachJwtUser(controller1, userId);
            var okRes = await controller1.Actualizar(criaId, new ActualizarGenealogiaRequest(padre1Id, madreId, "Modificacion Contexto 1", VersionRegistro: reg1.VersionRegistro), CancellationToken.None);
            Assert.IsType<OkObjectResult>(okRes);

            // 3. El contexto 2 mantiene reg2 rastreado con VersionRegistro = 1 (la validación previa pasa, pero SaveChangesAsync colisiona en BD) y la API devuelve HTTP 409 (ProblemDetails).
            var controller2 = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(db2, new FarmBovi.Api.Services.RanchAccessService(db2)));
            AttachJwtUser(controller2, userId);
            var conflictRes = await controller2.Actualizar(criaId, new ActualizarGenealogiaRequest(padre2Id, madreId, "Modificacion Contexto 2", VersionRegistro: reg2.VersionRegistro), CancellationToken.None);
            var conflictObj = Assert.IsAssignableFrom<ObjectResult>(conflictRes);
            Assert.Equal(StatusCodes.Status409Conflict, conflictObj.StatusCode);
            Assert.IsAssignableFrom<ProblemDetails>(conflictObj.Value);

            // 4. Comprobar también el caso determinístico de eliminación (contexto 1 elimina v=2->3) vs actualización con versión obsoleta (contexto 2 intenta PUT con v=2 -> 409).
            await using (var delCtx = MySqlTestHelper.CreateContext(connStr))
            {
                var delCtrl = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(delCtx, new FarmBovi.Api.Services.RanchAccessService(delCtx)));
                AttachJwtUser(delCtrl, userId);
                Assert.IsType<NoContentResult>(await delCtrl.Eliminar(criaId, versionRegistro: 2, CancellationToken.None));
            }
            await using (var stalePutAfterDelCtx = MySqlTestHelper.CreateContext(connStr))
            {
                var staleCtrl = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(stalePutAfterDelCtx, new FarmBovi.Api.Services.RanchAccessService(stalePutAfterDelCtx)));
                AttachJwtUser(staleCtrl, userId);
                var staleAfterDelRes = await staleCtrl.Actualizar(criaId, new ActualizarGenealogiaRequest(padre2Id, madreId, "Update tras Delete", VersionRegistro: 2), CancellationToken.None);
                var staleAfterDelObj = Assert.IsAssignableFrom<ObjectResult>(staleAfterDelRes);
                Assert.Equal(StatusCodes.Status409Conflict, staleAfterDelObj.StatusCode);
            }

            // 5. Comprobar en un tercer contexto que EF Core lanza DbUpdateConcurrencyException ante token obsoleto y que solo persistió la modificación esperada.
            await using var db3 = MySqlTestHelper.CreateContext(connStr);
            var reg3 = await db3.GenealogiasAnimales.FirstAsync(g => g.IdAnimal == criaId);
            Assert.Equal("Modificacion Contexto 1", reg3.Observaciones);
            Assert.Equal(padre1Id, reg3.IdPadre);
            Assert.Equal(3L, reg3.VersionRegistro);
            Assert.NotNull(reg3.EliminadoEn);

            db3.Entry(reg3).Property(x => x.VersionRegistro).OriginalValue = 1L;
            reg3.Observaciones = "Forzar DbUpdateConcurrencyException";
            await Assert.ThrowsAnyAsync<DbUpdateException>(() => db3.SaveChangesAsync());
        }
        finally
        {
            await MySqlTestHelper.CleanupDatabaseAsync(connStr, isIsolated, dbName);
        }
    }
}
