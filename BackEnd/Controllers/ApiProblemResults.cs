using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace FarmBovi.Api.Controllers;

/// <summary>
/// Helpers para garantizar que las respuestas de error y validación de los controladores
/// devuelvan ValidationProblemDetails (400) o ProblemDetails (401/403/404/409) de forma
/// consistente tanto en el pipeline HTTP como en pruebas unitarias directas.
/// </summary>
internal static class ApiProblemResults
{
    public static ActionResult ValidationError(this ControllerBase controller, string detail, string field = "")
    {
        if (controller.ProblemDetailsFactory is not null)
        {
            var modelState = new ModelStateDictionary();
            modelState.AddModelError(field, detail);
            return controller.ValidationProblem(
                modelStateDictionary: modelState,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Error de validación.",
                detail: detail);
        }

        return controller.BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
        {
            [field] = [detail]
        })
        {
            Status = StatusCodes.Status400BadRequest,
            Title = "Error de validación.",
            Detail = detail
        });
    }

    public static ObjectResult UnauthorizedProblem(this ControllerBase controller, string detail = "Se requiere un token de autenticación válido.") =>
        CreateProblem(controller, StatusCodes.Status401Unauthorized, "No autorizado.", detail);

    public static ObjectResult ForbiddenProblem(this ControllerBase controller, string detail = "No tienes permisos sobre el rancho de este registro.") =>
        CreateProblem(controller, StatusCodes.Status403Forbidden, "Acceso denegado.", detail);

    public static ObjectResult NotFoundProblem(this ControllerBase controller, string detail = "El recurso solicitado no existe.") =>
        CreateProblem(controller, StatusCodes.Status404NotFound, "Recurso no encontrado.", detail);

    public static ObjectResult ConflictProblem(this ControllerBase controller, string detail) =>
        CreateProblem(controller, StatusCodes.Status409Conflict, "Conflicto de recurso.", detail);

    private static ObjectResult CreateProblem(ControllerBase controller, int statusCode, string title, string detail)
    {
        if (controller.ProblemDetailsFactory is not null)
            return controller.Problem(statusCode: statusCode, title: title, detail: detail);

        return new ObjectResult(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Detail = detail
        })
        {
            StatusCode = statusCode
        };
    }

    public static DateTime EnsureUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };

    public static DateTime? EnsureUtc(DateTime? value) =>
        value.HasValue ? EnsureUtc(value.Value) : null;

    public static DateTime EnsureUtcDate(DateTime value)
    {
        var utc = EnsureUtc(value);
        return DateTime.SpecifyKind(utc.Date, DateTimeKind.Utc);
    }

    public static DateTime? EnsureUtcDate(DateTime? value) =>
        value.HasValue ? EnsureUtcDate(value.Value) : null;

    public static bool SameUtcInstant(DateTime a, DateTime b) =>
        EnsureUtc(a) == EnsureUtc(b);

    public static bool SameUtcInstant(DateTime? a, DateTime? b) =>
        a.HasValue == b.HasValue && (!a.HasValue || EnsureUtc(a.Value) == EnsureUtc(b!.Value));

    public static bool SameUtcDate(DateTime a, DateTime b) =>
        EnsureUtcDate(a) == EnsureUtcDate(b);

    public static bool SameUtcDate(DateTime? a, DateTime? b) =>
        a.HasValue == b.HasValue && (!a.HasValue || EnsureUtcDate(a.Value) == EnsureUtcDate(b!.Value));

    public static bool SameText(string? a, string? b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.Ordinal);
}
