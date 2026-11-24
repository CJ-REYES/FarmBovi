using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;

namespace FarmBovi.Api.Data;

/// <summary>
/// Reemplaza MySQLHistoryRepository para evitar GET_LOCK(..., -1),
/// que devuelve NULL en MariaDB y provoca InvalidCastException en MySql.EntityFrameworkCore.
/// Además acota el nombre del lock por base de datos y valida el resultado de GET_LOCK.
/// </summary>
public sealed class MariaDbCompatibleHistoryRepository(HistoryRepositoryDependencies dependencies)
    : HistoryRepository(dependencies)
{
    private const string LockNameSql = "LEFT(CONCAT('__EFMigrationsLock_', COALESCE(DATABASE(), '')), 64)";

    public override LockReleaseBehavior LockReleaseBehavior => LockReleaseBehavior.Explicit;

    protected override string ExistsSql =>
        $"SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{TableName}';";

    protected override bool InterpretExistsResult(object? value) =>
        value is not null && value != DBNull.Value;

    public override string GetCreateIfNotExistsScript()
    {
        var builder = new System.Text.StringBuilder();
        builder.AppendLine($"CREATE TABLE IF NOT EXISTS `{TableName}` (");
        builder.AppendLine("    `MigrationId` varchar(150) NOT NULL,");
        builder.AppendLine("    `ProductVersion` varchar(32) NOT NULL,");
        builder.AppendLine($"    CONSTRAINT `PK_{TableName}` PRIMARY KEY (`MigrationId`)");
        builder.AppendLine(") CHARACTER SET=utf8mb4;");
        return builder.ToString();
    }

    public override string GetBeginIfNotExistsScript(string migrationId) =>
        $"IF NOT EXISTS(SELECT 1 FROM `{TableName}` WHERE `MigrationId` = '{migrationId}') THEN";

    public override string GetBeginIfExistsScript(string migrationId) =>
        $"IF EXISTS(SELECT 1 FROM `{TableName}` WHERE `MigrationId` = '{migrationId}') THEN";

    public override string GetEndIfScript() => "END IF;";

    public override IMigrationsDatabaseLock AcquireDatabaseLock()
    {
        var result = Dependencies.RawSqlCommandBuilder
            .Build($"SELECT GET_LOCK({LockNameSql}, 30);")
            .ExecuteScalar(new RelationalCommandParameterObject(
                Dependencies.Connection, null, null, Dependencies.CurrentContext.Context, Dependencies.CommandLogger));
        EnsureLockAcquired(result);
        return new MariaDbMigrationLock(this);
    }

    public override async Task<IMigrationsDatabaseLock> AcquireDatabaseLockAsync(
        CancellationToken cancellationToken = default)
    {
        var result = await Dependencies.RawSqlCommandBuilder
            .Build($"SELECT GET_LOCK({LockNameSql}, 30);")
            .ExecuteScalarAsync(new RelationalCommandParameterObject(
                Dependencies.Connection, null, null, Dependencies.CurrentContext.Context, Dependencies.CommandLogger),
                cancellationToken);
        EnsureLockAcquired(result);
        return new MariaDbMigrationLock(this);
    }

    public static void EnsureLockAcquired(object? scalarResult)
    {
        if (scalarResult is null || scalarResult == DBNull.Value)
            throw new InvalidOperationException("No se pudo adquirir el bloqueo de migraciones en MySQL/MariaDB (GET_LOCK devolvió NULL).");

        if (Convert.ToInt32(scalarResult) != 1)
            throw new InvalidOperationException("Tiempo de espera agotado al adquirir el bloqueo de migraciones en MySQL/MariaDB.");
    }

    private void ReleaseLock()
    {
        Dependencies.RawSqlCommandBuilder
            .Build($"SELECT RELEASE_LOCK({LockNameSql});")
            .ExecuteScalar(new RelationalCommandParameterObject(
                Dependencies.Connection, null, null, Dependencies.CurrentContext.Context, Dependencies.CommandLogger));
    }

    private async Task ReleaseLockAsync()
    {
        await Dependencies.RawSqlCommandBuilder
            .Build($"SELECT RELEASE_LOCK({LockNameSql});")
            .ExecuteScalarAsync(new RelationalCommandParameterObject(
                Dependencies.Connection, null, null, Dependencies.CurrentContext.Context, Dependencies.CommandLogger));
    }

    private sealed class MariaDbMigrationLock(MariaDbCompatibleHistoryRepository repository) : IMigrationsDatabaseLock
    {
        public IHistoryRepository HistoryRepository => repository;
        public void Dispose() => repository.ReleaseLock();
        public ValueTask DisposeAsync() => new(repository.ReleaseLockAsync());
    }
}
