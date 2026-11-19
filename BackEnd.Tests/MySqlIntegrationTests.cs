using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
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
    private static void AttachJwtUser(ControllerBase controller, Guid userId)
    {
        var identity = new ClaimsIdentity(
        [
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString("D")),
            new Claim(ClaimTypes.NameIdentifier, userId.ToString("D"))
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

            var userId = Guid.NewGuid();
            var ranchoId = Guid.NewGuid();
            var loteId = Guid.NewGuid();

            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario
                {
                    IdUsuario = userId,
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
                    var c1 = new SincronizacionController(db1);
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
                    var c2 = new SincronizacionController(db2);
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
                    var c1 = new SincronizacionController(db1);
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
                    var c2 = new SincronizacionController(db2);
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

        try
        {
            // 1. Aplicar únicamente la migración inicial anterior (int IDs)
            await using (var db = MySqlTestHelper.CreateContext(connStr))
            {
                var migrator = db.GetService<IMigrator>();
                await migrator.MigrateAsync("20261116071310_InitialMySqlModels");
            }

            // 2. Insertar datos reales previos con IDs enteros
            await using (var conn = new MySqlConnection(connStr))
            {
                await conn.OpenAsync();
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    INSERT INTO `Usuario` (`Id`, `Nombre`, `Correo`, `Contrasena`, `Estado`)
                    VALUES (1, 'Roberto Legacy', 'legacy@farmbovi.local', 'hash_legacy', 'Activo');

                    INSERT INTO `Rancho` (`IdRancho`, `Nombre`, `UbicacionGeneral`, `Estado`, `IdAutor`, `CreadoEn`, `VersionRegistro`)
                    VALUES (10, 'Rancho Legacy', 'Campeche', 'Activo', 1, UTC_TIMESTAMP(6), 1);

                    INSERT INTO `UsuarioRancho` (`IdUsuarioRancho`, `IdUsuario`, `IdRancho`, `Rol`, `Estado`, `FechaAlta`)
                    VALUES (100, 1, 10, 'Admin', 'Activo', UTC_TIMESTAMP(6));

                    INSERT INTO `Lote` (`IdLote`, `IdRancho`, `Nombre`, `Ubicacion`, `Estado`, `IdAutor`, `FechaCreacion`, `VersionRegistro`)
                    VALUES (20, 10, 'Lote Legacy', 'Zona 1', 'Activo', 1, UTC_TIMESTAMP(6), 1);

                    INSERT INTO `Animal` (`IdAnimal`, `IdRancho`, `IdLote`, `Arete`, `Raza`, `Sexo`, `FechaIngreso`, `Procedencia`, `Estado`, `IdAutor`, `FechaCreacion`, `VersionRegistro`)
                    VALUES (30, 10, 20, 'LEG-001', 'Brahman', 'Hembra', UTC_TIMESTAMP(6), 'Propio', 'Activo', 1, UTC_TIMESTAMP(6), 1);
                    """;
                await cmd.ExecuteNonQueryAsync();
            }

            // 3. Aplicar la migración incremental hacia el esquema actual (char(36) + Sync)
            await using (var db = MySqlTestHelper.CreateContext(connStr))
            {
                await db.Database.MigrateAsync();
            }

            // 4. Verificar que todos los registros y relaciones sobrevivieron con UUID válidos
            await using (var verifyDb = MySqlTestHelper.CreateContext(connStr))
            {
                var user = await verifyDb.Usuarios.SingleAsync(u => u.Correo == "legacy@farmbovi.local");
                var rancho = await verifyDb.Ranchos.SingleAsync(r => r.Nombre == "Rancho Legacy");
                var ur = await verifyDb.UsuarioRanchos.SingleAsync();
                var lote = await verifyDb.Lotes.SingleAsync(l => l.Nombre == "Lote Legacy");
                var animal = await verifyDb.Animales.SingleAsync(a => a.Arete == "LEG-001");

                Assert.NotEqual(Guid.Empty, user.IdUsuario);
                Assert.Equal(user.IdUsuario, rancho.IdAutor);
                Assert.Equal(user.IdUsuario, ur.IdUsuario);
                Assert.Equal(rancho.IdRancho, ur.IdRancho);
                Assert.Equal(rancho.IdRancho, lote.IdRancho);
                Assert.Equal(rancho.IdRancho, animal.IdRancho);
                Assert.Equal(lote.IdLote, animal.IdLote);
                Assert.Equal(user.IdUsuario, animal.IdAutor);
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
            var adminId = Guid.NewGuid();
            var ranchId = Guid.NewGuid();
            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario { IdUsuario = adminId, Nombre = "Admin", Correo = $"admin-{adminId:N}@farmbovi.local", Contrasena = "hash", Estado = "Activo" });
                seedDb.Ranchos.Add(new Rancho { IdRancho = ranchId, Nombre = "Rancho", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = adminId });
                seedDb.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = adminId, IdRancho = ranchId, Rol = "Admin", Estado = "Activo" });
                await seedDb.SaveChangesAsync();
            }

            var correo = $"race-{Guid.NewGuid():N}@farmbovi.local";
            async Task<int> CreateAsync(string nombre)
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var controller = new UsuarioController(db, new FarmBovi.Api.Services.RanchAccessService(db));
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

            var userId = Guid.NewGuid();
            var ranchId = Guid.NewGuid();
            var padre1Id = Guid.NewGuid();
            var padre2Id = Guid.NewGuid();
            var madreId = Guid.NewGuid();
            var criaId = Guid.NewGuid();

            await using (var seedDb = MySqlTestHelper.CreateContext(connStr))
            {
                seedDb.Usuarios.Add(new Usuario { IdUsuario = userId, Nombre = "Prod", Correo = $"g-{userId:N}@farmbovi.local", Contrasena = "h", Estado = "Activo" });
                seedDb.Ranchos.Add(new Rancho { IdRancho = ranchId, Nombre = "Rancho G", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userId });
                seedDb.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = userId, IdRancho = ranchId, Rol = "Administrador", Estado = "Activo" });
                seedDb.Animales.AddRange(
                    new Animal { IdAnimal = padre1Id, IdRancho = ranchId, Arete = "G-P1", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = padre2Id, IdRancho = ranchId, Arete = "G-P2", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = madreId, IdRancho = ranchId, Arete = "G-M1", Raza = "Angus", Sexo = "Hembra", Procedencia = "Propio", Estado = "Activo", IdAutor = userId },
                    new Animal { IdAnimal = criaId, IdRancho = ranchId, Arete = "G-C1", Raza = "Angus", Sexo = "Macho", Procedencia = "Propio", Estado = "Activo", IdAutor = userId });
                await seedDb.SaveChangesAsync();
            }

            // 1. Inserciones simultáneas sobre el mismo animal: una gana (201), la otra recibe 409 por índice único en IdAnimal.
            async Task<int> ConcurrentInsertAsync(Guid padreId)
            {
                await using var db = MySqlTestHelper.CreateContext(connStr);
                var controller = new GenealogiaController(new FarmBovi.Api.Services.GenealogiaService(db, new FarmBovi.Api.Services.RanchAccessService(db)));
                AttachJwtUser(controller, userId);
                var res = await controller.Registrar(new RegistrarGenealogiaRequest(criaId, padreId, madreId, "Concurrente"), CancellationToken.None);
                return res switch
                {
                    CreatedAtActionResult => StatusCodes.Status201Created,
                    ConflictObjectResult => StatusCodes.Status409Conflict,
                    _ => throw new InvalidOperationException($"Respuesta inesperada: {res.GetType().Name}")
                };
            }

            var insertStatuses = await Task.WhenAll(ConcurrentInsertAsync(padre1Id), ConcurrentInsertAsync(padre2Id));
            Assert.Contains(StatusCodes.Status201Created, insertStatuses);
            Assert.Contains(StatusCodes.Status409Conflict, insertStatuses);

            // 2. Actualizaciones simultáneas sobre el mismo registro: una gana (200), la otra recibe 409 por VersionRegistro.
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
                    new ActualizarGenealogiaRequest(nuevoPadre, madreId, obs, VersionRegistro: 1),
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

            // 3. Verificar integridad y CambioServidor en MySQL real.
            await using var verifyDb = MySqlTestHelper.CreateContext(connStr);
            Assert.Equal(1, await verifyDb.GenealogiasAnimales.CountAsync(g => g.IdAnimal == criaId));
            var cambios = await verifyDb.CambiosServidor.AsNoTracking()
                .Where(c => c.Entidad == nameof(GenealogiaAnimal))
                .OrderBy(c => c.Version)
                .ToListAsync();
            Assert.Equal(2, cambios.Count);
            Assert.Equal(["Crear", "Actualizar"], cambios.Select(c => c.Operacion).ToArray());
        }
        finally
        {
            await MySqlTestHelper.CleanupDatabaseAsync(connStr, isIsolated, dbName);
        }
    }
}
