using FarmBovi.Api.DTOs;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/genealogia")]
public sealed class GenealogiaController(GenealogiaService genealogia) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<GenealogiaRegistroDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> Listar(
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return UnauthorizedProblem();

        var result = await genealogia.ListarAsync(userId, idRancho, incluirEliminados, ct);
        return ToActionResult(result);
    }

    [HttpPost]
    [ProducesResponseType(typeof(GenealogiaRegistroDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(GenealogiaRegistroDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Registrar([FromBody] RegistrarGenealogiaRequest request, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return UnauthorizedProblem();

        var result = await genealogia.RegistrarAsync(request, userId, ct);
        if (result.Status == GenealogiaOperationStatus.Success && result.Data is { } created)
        {
            if (result.IsIdempotent)
                return Ok(created);

            return CreatedAtAction(
                nameof(ObtenerPorId),
                new { idGenealogia = created.IdGenealogia },
                created);
        }

        return ToActionResult(result);
    }

    [HttpGet("{idGenealogia:guid}")]
    [ProducesResponseType(typeof(GenealogiaRegistroDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ObtenerPorId(Guid idGenealogia, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return UnauthorizedProblem();

        var result = await genealogia.ObtenerPorIdAsync(idGenealogia, userId, ct);
        return ToActionResult(result);
    }

    [HttpPut("{idAnimal:guid}")]
    [ProducesResponseType(typeof(GenealogiaRegistroDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Actualizar(Guid idAnimal, [FromBody] ActualizarGenealogiaRequest request, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return UnauthorizedProblem();

        var result = await genealogia.ActualizarAsync(idAnimal, request, userId, ct);
        return ToActionResult(result);
    }

    [HttpDelete("{idAnimal:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Eliminar(
        Guid idAnimal,
        [FromQuery] long? versionRegistro = null,
        CancellationToken ct = default)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return UnauthorizedProblem();

        var (ifMatchPresent, ifMatchVersion) = ParseIfMatchVersion();
        if (ifMatchPresent && ifMatchVersion <= 0)
        {
            return ValidationErrorResult(
                "La cabecera If-Match debe indicar una versión numérica positiva válida.",
                nameof(versionRegistro));
        }

        if (versionRegistro is { } queryVer && ifMatchPresent && queryVer != ifMatchVersion)
        {
            return ValidationErrorResult(
                "La versión indicada en versionRegistro y en la cabecera If-Match no coinciden.",
                nameof(versionRegistro));
        }

        var expectedVersion = versionRegistro ?? (ifMatchPresent ? ifMatchVersion : null);
        if (expectedVersion is null || expectedVersion <= 0)
        {
            return ValidationErrorResult(
                "La versión del registro (versionRegistro o cabecera If-Match) es obligatoria y debe ser mayor que cero.",
                nameof(versionRegistro));
        }

        var result = await genealogia.EliminarAsync(idAnimal, userId, ct, expectedVersion);
        if (result.Status == GenealogiaOperationStatus.Success)
            return NoContent();

        return ToActionResult(result);
    }

    [HttpGet("{idAnimal:guid}/padres")]
    [ProducesResponseType(typeof(PadresAnimalResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ObtenerPadres(Guid idAnimal, [FromQuery] int profundidad = 1, CancellationToken ct = default)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return UnauthorizedProblem();

        var result = await genealogia.ObtenerPadresAsync(idAnimal, profundidad, userId, ct);
        return ToActionResult(result);
    }

    [HttpGet("{idAnimal:guid}/descendientes")]
    [ProducesResponseType(typeof(DescendientesAnimalResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ObtenerDescendientes(Guid idAnimal, [FromQuery] int profundidad = 1, CancellationToken ct = default)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return UnauthorizedProblem();

        var result = await genealogia.ObtenerDescendientesAsync(idAnimal, profundidad, userId, ct);
        return ToActionResult(result);
    }

    private (bool Present, long Version) ParseIfMatchVersion()
    {
        var headers = Request?.Headers.IfMatch;
        if (headers is null || headers.Value.Count == 0)
            return (false, 0);

        var raw = headers.Value.FirstOrDefault()?.Trim();
        if (string.IsNullOrWhiteSpace(raw))
            return (true, 0);

        if (raw.StartsWith("W/", StringComparison.OrdinalIgnoreCase))
            raw = raw[2..].Trim();

        raw = raw.Trim('"');
        return long.TryParse(raw, out var version) && version > 0
            ? (true, version)
            : (true, 0);
    }

    private IActionResult ToActionResult<T>(GenealogiaOperationResult<T> result) =>
        result.Status switch
        {
            GenealogiaOperationStatus.Success => Ok(result.Data),
            GenealogiaOperationStatus.BadRequest => ValidationErrorResult(result.Error),
            GenealogiaOperationStatus.NotFound => ProblemResult(
                StatusCodes.Status404NotFound,
                "Recurso no encontrado.",
                result.Error ?? "El recurso solicitado no existe."),
            GenealogiaOperationStatus.Forbidden => ProblemResult(
                StatusCodes.Status403Forbidden,
                "Acceso denegado.",
                result.Error ?? "No tienes permisos sobre el rancho de este registro."),
            GenealogiaOperationStatus.Conflict => ProblemResult(
                StatusCodes.Status409Conflict,
                "Conflicto de recurso.",
                result.Error),
            _ => ValidationErrorResult(result.Error)
        };

    private IActionResult UnauthorizedProblem() =>
        ProblemResult(
            StatusCodes.Status401Unauthorized,
            "No autorizado.",
            "Se requiere un token de autenticación válido.");

    private IActionResult ValidationErrorResult(string? detail, string field = "")
    {
        var message = detail ?? "Error de validación.";
        if (ProblemDetailsFactory is not null)
        {
            var modelState = new ModelStateDictionary();
            modelState.AddModelError(field, message);
            return ValidationProblem(
                modelStateDictionary: modelState,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Error de validación.",
                detail: message);
        }

        return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
        {
            [field] = [message]
        })
        {
            Status = StatusCodes.Status400BadRequest,
            Title = "Error de validación.",
            Detail = message
        });
    }

    private IActionResult ProblemResult(int statusCode, string title, string? detail)
    {
        if (ProblemDetailsFactory is not null)
            return Problem(statusCode: statusCode, title: title, detail: detail);

        return StatusCode(statusCode, new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Detail = detail
        });
    }
}
