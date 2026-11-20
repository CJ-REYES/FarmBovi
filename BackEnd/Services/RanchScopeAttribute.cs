using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace FarmBovi.Api.Services;

public enum RanchResource
{
    Rancho,
    Lote,
    Animal,
    EventoSanitario,
    Tratamiento,
    Recordatorio,
    Alimentacion,
    MovimientoAnimal,
    UsuarioRancho
}

/// <summary>
/// Aplica la autorización por rancho a un controlador CRUD:
/// <list type="bullet">
/// <item>Rutas con <c>{id}</c>: el registro existente debe pertenecer a un rancho del usuario.</item>
/// <item>Cuerpos de solicitud: toda referencia (IdRancho, IdLote, IdAnimal, IdEventoSanitario,
/// IdTratamiento...) que exista debe pertenecer a un rancho del usuario.</item>
/// <item>Opcionalmente exige rol administrador para crear, actualizar o eliminar.</item>
/// </list>
/// Las referencias inexistentes no se resuelven aquí: las valida el controlador (400/404).
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class RanchScopeAttribute(RanchResource resource) : Attribute, IFilterFactory
{
    public RanchResource Resource { get; } = resource;
    public bool AdminForCreate { get; init; }
    public bool AdminForUpdateDelete { get; init; }
    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider) =>
        new RanchScopeFilter(this, serviceProvider.GetRequiredService<RanchAccessService>());
}

public sealed class RanchScopeFilter(RanchScopeAttribute options, RanchAccessService access) : IAsyncActionFilter, IOrderedFilter
{
    private static readonly string[] LoteProperties = ["IdLote", "IdLoteOrigen", "IdLoteDestino"];

    public int Order => -100;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var ct = context.HttpContext.RequestAborted;
        if (RanchAccessService.GetUserId(context.HttpContext.User) is not { } userId)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status401Unauthorized,
                Title = "No autorizado.",
                Detail = "Se requiere un token de autenticación válido."
            })
            {
                StatusCode = StatusCodes.Status401Unauthorized
            };
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
                context.Result = new ObjectResult(new ProblemDetails
                {
                    Status = StatusCodes.Status403Forbidden,
                    Title = "Acceso denegado.",
                    Detail = "No tienes permisos sobre el rancho de este registro."
                })
                {
                    StatusCode = StatusCodes.Status403Forbidden
                };
                return;
            }
        }

        if (!context.ModelState.IsValid)
        {
            context.Result = new BadRequestObjectResult(new ValidationProblemDetails(context.ModelState)
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Error de validación.",
                Detail = "Uno o más campos no cumplen con las reglas de validación."
            });
            return;
        }

        await next();
    }

    private Task<Guid?> ResolveResourceAsync(RanchResource resource, Guid id, CancellationToken ct) => resource switch
    {
        RanchResource.Rancho => access.RanchOfRanchAsync(id, ct),
        RanchResource.Lote => access.RanchOfLoteAsync(id, ct),
        RanchResource.Animal => access.RanchOfAnimalAsync(id, ct),
        RanchResource.EventoSanitario => access.RanchOfEventoSanitarioAsync(id, ct),
        RanchResource.Tratamiento => access.RanchOfTratamientoAsync(id, ct),
        RanchResource.Recordatorio => access.RanchOfRecordatorioAsync(id, ct),
        RanchResource.Alimentacion => access.RanchOfAlimentacionAsync(id, ct),
        RanchResource.MovimientoAnimal => access.RanchOfMovimientoAsync(id, ct),
        RanchResource.UsuarioRancho => access.RanchOfUsuarioRanchoAsync(id, ct),
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

        await AddAsync("IdRancho", access.RanchOfRanchAsync);
        foreach (var name in LoteProperties)
            await AddAsync(name, access.RanchOfLoteAsync);
        await AddAsync("IdAnimal", access.RanchOfAnimalAsync);
        await AddAsync("IdEventoSanitario", access.RanchOfEventoSanitarioAsync);
        await AddAsync("IdTratamiento", access.RanchOfTratamientoAsync);
        await AddAsync("IdRecordatorio", access.RanchOfRecordatorioAsync);
        await AddAsync("IdAlimentacion", access.RanchOfAlimentacionAsync);
        await AddAsync("IdMovimiento", access.RanchOfMovimientoAsync);
        await AddAsync("IdUsuarioRancho", access.RanchOfUsuarioRanchoAsync);
    }
}
