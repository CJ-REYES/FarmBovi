using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;

namespace FarmBovi.Api.Services;

public enum RanchResource
{
    Rancho,
    Lote,
    Animal,
    EventoSanitario,
    EventoReproductivo,
    Tratamiento,
    Recordatorio,
    Alimentacion,
    MovimientoAnimal,
    UsuarioRancho,
    Pesaje,
    ArchivoMultimedia
}

/// <summary>
/// Aplica la autorización por rancho a un controlador CRUD:
/// <list type="bullet">
/// <item>Rutas con <c>{id}</c>: el registro existente debe pertenecer a un rancho del usuario.</item>
/// <item>Cuerpos de solicitud: toda referencia (IdRancho, IdRanchoDestino, IdLote, IdAnimal, IdEventoSanitario,
/// IdTratamiento, IdRecordatorio, IdAlimentacion, IdMovimiento, IdUsuarioRancho...) que exista debe pertenecer
/// a un rancho del usuario.</item>
/// <item>Opcionalmente exige rol administrador para crear, actualizar o eliminar.</item>
/// </list>
/// Las referencias inexistentes no se resuelven aquí: las valida el controlador (400/404).
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class RanchScopeAttribute(RanchResource resource) : Attribute, IFilterFactory, IOrderedFilter
{
    public RanchResource Resource { get; } = resource;
    public bool AdminForCreate { get; init; }
    public bool AdminForUpdateDelete { get; init; }
    public bool IsReusable => false;

    // Debe declararse en el IFilterFactory para que ASP.NET Core ordene el filtro antes de ModelStateValidationFilter (-50).
    public int Order => -100;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider) =>
        new RanchScopeFilter(this, serviceProvider.GetRequiredService<RanchAccessService>());
}

public sealed class RanchScopeFilter(RanchScopeAttribute options, RanchAccessService access) : IAsyncActionFilter, IOrderedFilter
{
    private static readonly string[] RanchoProperties = ["IdRancho", "IdRanchoDestino"];
    private static readonly string[] LoteProperties = ["IdLote", "IdLoteOrigen", "IdLoteDestino"];

    // Se ejecuta antes de ModelStateValidationFilter (-50) para priorizar 401/403 sobre 400.
    public int Order => -100;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var ct = context.HttpContext.RequestAborted;
        if (RanchAccessService.GetUserId(context.HttpContext.User) is not { } userId)
        {
            context.Result = CreateProblemResult(
                context,
                StatusCodes.Status401Unauthorized,
                "No autorizado.",
                "Se requiere un token de autenticación válido.");
            return;
        }

        var method = context.HttpContext.Request.Method;
        var needsAdmin = (HttpMethods.IsPost(method) && options.AdminForCreate) ||
                         ((HttpMethods.IsPut(method) || HttpMethods.IsDelete(method) || HttpMethods.IsPatch(method)) &&
                          options.AdminForUpdateDelete);

        var ranchIds = new HashSet<Guid>();
        if (context.ActionArguments.TryGetValue("id", out var idValue) && idValue is Guid id && id != Guid.Empty &&
            await ResolveResourceAsync(options.Resource, id, ct) is { } ownerRanch)
            ranchIds.Add(ownerRanch);

        if (context.ActionArguments.TryGetValue("idRancho", out var queryRanchValue) &&
            queryRanchValue is Guid queryRanchId && queryRanchId != Guid.Empty)
            ranchIds.Add(queryRanchId);

        foreach (var argument in context.ActionArguments.Values)
        {
            if (argument is null || argument is Guid || argument is string || argument.GetType().IsPrimitive ||
                argument is CancellationToken || argument is RanchAccessService)
                continue;
            await CollectBodyReferencesAsync(argument, ranchIds, ct);
        }

        foreach (var ranchId in ranchIds)
        {
            var allowed = ranchId != Guid.Empty && (needsAdmin
                ? await access.IsAdminAsync(userId, ranchId, ct)
                : await access.CanAccessAsync(userId, ranchId, ct));
            if (!allowed)
            {
                context.Result = CreateProblemResult(
                    context,
                    StatusCodes.Status403Forbidden,
                    "Acceso denegado.",
                    "No tienes permisos sobre el rancho de este registro.");
                return;
            }
        }

        await next();
    }

    private static ObjectResult CreateProblemResult(ActionExecutingContext context, int statusCode, string title, string detail)
    {
        var factory = context.HttpContext.RequestServices.GetService<ProblemDetailsFactory>();
        var problem = factory is not null
            ? factory.CreateProblemDetails(context.HttpContext, statusCode: statusCode, title: title, detail: detail)
            : new ProblemDetails
            {
                Status = statusCode,
                Title = title,
                Detail = detail
            };

        return new ObjectResult(problem)
        {
            StatusCode = statusCode,
            ContentTypes = { "application/problem+json" }
        };
    }

    private Task<Guid?> ResolveResourceAsync(RanchResource resource, Guid id, CancellationToken ct) => resource switch
    {
        RanchResource.Rancho => access.RanchOfRanchAsync(id, ct),
        RanchResource.Lote => access.RanchOfLoteAsync(id, ct),
        RanchResource.Animal => access.RanchOfAnimalAsync(id, ct),
        RanchResource.EventoSanitario => access.RanchOfEventoSanitarioAsync(id, ct),
        RanchResource.EventoReproductivo => access.RanchOfEventoReproductivoAsync(id, ct),
        RanchResource.Tratamiento => access.RanchOfTratamientoAsync(id, ct),
        RanchResource.Recordatorio => access.RanchOfRecordatorioAsync(id, ct),
        RanchResource.Alimentacion => access.RanchOfAlimentacionAsync(id, ct),
        RanchResource.MovimientoAnimal => access.RanchOfMovimientoAsync(id, ct),
        RanchResource.UsuarioRancho => access.RanchOfUsuarioRanchoAsync(id, ct),
        RanchResource.Pesaje => access.RanchOfPesajeAsync(id, ct),
        RanchResource.ArchivoMultimedia => access.RanchOfArchivoMultimediaAsync(id, ct),
        _ => Task.FromResult<Guid?>(Guid.Empty)
    };

    private async Task CollectBodyReferencesAsync(object body, HashSet<Guid> ranchIds, CancellationToken ct)
    {
        var type = body.GetType();

        async Task AddAsync(string propertyName, Func<Guid, CancellationToken, Task<Guid?>> resolver)
        {
            var property = type.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
            if (property?.GetValue(body) is Guid value && value != Guid.Empty &&
                await resolver(value, ct) is { } ranch)
                ranchIds.Add(ranch);
        }

        foreach (var name in RanchoProperties)
            await AddAsync(name, access.RanchOfRanchAsync);
        foreach (var name in LoteProperties)
            await AddAsync(name, access.RanchOfLoteAsync);
        await AddAsync("IdAnimal", access.RanchOfAnimalAsync);
        await AddAsync("IdSemental", access.RanchOfAnimalAsync);
        await AddAsync("IdEventoSanitario", access.RanchOfEventoSanitarioAsync);
        await AddAsync("IdEventoReproductivo", access.RanchOfEventoReproductivoAsync);
        await AddAsync("IdTratamiento", access.RanchOfTratamientoAsync);
        await AddAsync("IdRecordatorio", access.RanchOfRecordatorioAsync);
        await AddAsync("IdAlimentacion", access.RanchOfAlimentacionAsync);
        await AddAsync("IdMovimiento", access.RanchOfMovimientoAsync);
        await AddAsync("IdUsuarioRancho", access.RanchOfUsuarioRanchoAsync);
        await AddAsync("IdPesaje", access.RanchOfPesajeAsync);
        await AddAsync("IdArchivo", access.RanchOfArchivoMultimediaAsync);
    }
}
