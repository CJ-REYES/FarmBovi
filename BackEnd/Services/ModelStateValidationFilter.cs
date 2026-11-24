using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;

namespace FarmBovi.Api.Services;

/// <summary>
/// Valida ModelState de forma global para todos los controladores con respuesta RFC 7807
/// (<see cref="ValidationProblemDetails"/>), ejecutándose después de <see cref="RanchScopeFilter"/>
/// (<c>Order = -100</c>) para que la autorización por rancho prevalezca sobre errores de validación.
/// </summary>
public sealed class ModelStateValidationFilter : IActionFilter, IOrderedFilter
{
    public int Order => -50;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.ModelState.IsValid)
            return;

        var factory = context.HttpContext.RequestServices.GetService<ProblemDetailsFactory>();
        var problem = factory is not null
            ? factory.CreateValidationProblemDetails(
                context.HttpContext,
                context.ModelState,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Error de validación.",
                detail: "Uno o más campos no cumplen con las reglas de validación.")
            : new ValidationProblemDetails(context.ModelState)
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Error de validación.",
                Detail = "Uno o más campos no cumplen con las reglas de validación."
            };

        context.Result = new BadRequestObjectResult(problem)
        {
            ContentTypes = { "application/problem+json" }
        };
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
