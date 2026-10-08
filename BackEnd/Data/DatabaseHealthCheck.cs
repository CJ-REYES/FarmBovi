using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace FarmBovi.Api.Data;

public sealed class DatabaseHealthCheck(IServiceScopeFactory scopeFactory) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
        try
        {
            return await database.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("No se pudo conectar con la base de datos.");
        }
        catch (Exception exception)
        {
            return HealthCheckResult.Unhealthy("No se pudo conectar con la base de datos.", exception);
        }
    }
}
