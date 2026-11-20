using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace FarmBovi.Api.Controllers;

/// <summary>
/// Helpers para garantizar que todas las respuestas de error y validación de los controladores
/// devuelvan exactamente ValidationProblemDetails (400) o ProblemDetails (401/403/404/409).
/// </summary>
internal static class ApiProblemResults
{
    public static ActionResult ValidationError(this ControllerBase controller, string detail, string field = "")
    {
        var modelState = new ModelStateDictionary();
        modelState.AddModelError(field, detail);
        return controller.ValidationProblem(
            modelStateDictionary: modelState,
            statusCode: StatusCodes.Status400BadRequest,
            title: "Error de validación.",
            detail: detail);
    }

    public static ObjectResult ConflictProblem(this ControllerBase controller, string detail) =>
        controller.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: "Conflicto de recurso.",
            detail: detail);

    public static ObjectResult NotFoundProblem(this ControllerBase controller, string detail = "El recurso solicitado no existe.") =>
        controller.Problem(
            statusCode: StatusCodes.Status404NotFound,
            title: "Recurso no encontrado.",
            detail: detail);

    public static ObjectResult ForbiddenProblem(this ControllerBase controller, string detail = "No tienes permisos sobre el rancho de este registro.") =>
        controller.Problem(
            statusCode: StatusCodes.Status403Forbidden,
            title: "Acceso denegado.",
            detail: detail);

    public static DateTime EnsureUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };

    public static DateTime? EnsureUtc(DateTime? value) =>
        value.HasValue ? EnsureUtc(value.Value) : null;

    public static bool SameUtcInstant(DateTime a, DateTime b) =>
        EnsureUtc(a) == EnsureUtc(b);

    public static bool SameUtcInstant(DateTime? a, DateTime? b) =>
        a.HasValue == b.HasValue && (!a.HasValue || EnsureUtc(a.Value) == EnsureUtc(b!.Value));

    public static bool SameText(string? a, string? b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.Ordinal);
}
