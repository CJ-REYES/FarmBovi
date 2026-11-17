using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;

namespace FarmBovi.Api.Data;

/// <summary>
/// Reemplaza MySQLHistoryRepository para evitar GET_LOCK(..., -1),
/// que devuelve NULL en MariaDB y provoca InvalidCastException en MySql.EntityFrameworkCore.
/// </summary>
public sealed class MariaDbCompatibleHistoryRepository(HistoryRepositoryDependencies dependencies)
    : HistoryRepository(dependencies)
{
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
        builder.AppendLine(");");
        return builder.ToString();
    }

    public override string GetBeginIfNotExistsScript(string migrationId) =>
        $"IF NOT EXISTS(SELECT 1 FROM `{TableName}` WHERE `MigrationId` = '{migrationId}') THEN";

    public override string GetBeginIfExistsScript(string migrationId) =>
        $"IF EXISTS(SELECT 1 FROM `{TableName}` WHERE `MigrationId` = '{migrationId}') THEN";

    public override string GetEndIfScript() => "END IF;";

    public override IMigrationsDatabaseLock AcquireDatabaseLock()
    {
        Dependencies.RawSqlCommandBuilder
            .Build("SELECT GET_LOCK('__EFMigrationsLock', 30);")
            .ExecuteScalar(new RelationalCommandParameterObject(
                Dependencies.Connection, null, null, Dependencies.CurrentContext.Context, Dependencies.CommandLogger));
        return new MariaDbMigrationLock(this);
    }

    public override async Task<IMigrationsDatabaseLock> AcquireDatabaseLockAsync(
        CancellationToken cancellationToken = default)
    {
        await Dependencies.RawSqlCommandBuilder
            .Build("SELECT GET_LOCK('__EFMigrationsLock', 30);")
            .ExecuteScalarAsync(new RelationalCommandParameterObject(
                Dependencies.Connection, null, null, Dependencies.CurrentContext.Context, Dependencies.CommandLogger),
                cancellationToken);
        return new MariaDbMigrationLock(this);
    }

    private void ReleaseLock()
    {
        Dependencies.RawSqlCommandBuilder
            .Build("SELECT RELEASE_LOCK('__EFMigrationsLock');")
            .ExecuteScalar(new RelationalCommandParameterObject(
                Dependencies.Connection, null, null, Dependencies.CurrentContext.Context, Dependencies.CommandLogger));
    }

    private async Task ReleaseLockAsync()
    {
        await Dependencies.RawSqlCommandBuilder
            .Build("SELECT RELEASE_LOCK('__EFMigrationsLock');")
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
