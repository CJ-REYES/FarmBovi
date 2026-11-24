using FarmBovi.Api.DTOs;
using FarmBovi.Api.Services;
using FarmBovi.Api.Services.BoviScale;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FarmBovi.Api.Controllers;

/// <summary>
/// Proxy autenticado del módulo BoviScale para solicitar estimaciones de peso bovino
/// mediante la API externa en Python y persistir los pesajes válidos en MySQL/MariaDB.
/// </summary>
[ApiController]
[Route("api/boviscale")]
[Authorize]
public sealed class BoviScaleController(BoviScaleEstimationService estimationService) : ControllerBase
{
    /// <summary>
    /// Solicita la estimación de peso de un bovino a partir de una fotografía almacenada,
    /// invocando la API Python externa y registrando el pesaje resultante de forma idempotente.
    /// </summary>
    [HttpPost("estimaciones")]
    [ProducesResponseType(typeof(EstimacionPesoBoviScaleResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(EstimacionPesoBoviScaleResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status422UnprocessableEntity)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status502BadGateway)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status503ServiceUnavailable)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status504GatewayTimeout)]
    public async Task<ActionResult<EstimacionPesoBoviScaleResponseDto>> SolicitarEstimacion(
        [FromBody] SolicitarEstimacionPesoRequestDto request,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null)
            return this.UnauthorizedProblem();

        var outcome = await estimationService.EstimateAndRecordAsync(userId.Value, request, ct);
        return ToActionResult(outcome, includeCreatedLocation: true);
    }

    /// <summary>
    /// Consulta el resultado persistido de una estimación previa por su identificador de solicitud.
    /// </summary>
    [HttpGet("estimaciones/{idSolicitud:guid}")]
    [ProducesResponseType(typeof(EstimacionPesoBoviScaleResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<EstimacionPesoBoviScaleResponseDto>> GetEstimacionPorSolicitud(
        Guid idSolicitud,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null)
            return this.UnauthorizedProblem();

        var outcome = await estimationService.GetBySolicitudAsync(userId.Value, idSolicitud, ct);
        return ToActionResult(outcome, includeCreatedLocation: false);
    }

    private ActionResult<EstimacionPesoBoviScaleResponseDto> ToActionResult(
        BoviScaleServiceOutcome outcome,
        bool includeCreatedLocation)
    {
        if (outcome.RetryAfterSeconds is > 0)
        {
            Response.Headers.RetryAfter = outcome.RetryAfterSeconds.Value.ToString();
        }

        if (outcome.IsSuccess && outcome.Data is not null)
        {
            if (outcome.StatusCode == StatusCodes.Status201Created && includeCreatedLocation)
            {
                return CreatedAtAction(
                    nameof(GetEstimacionPorSolicitud),
                    new { idSolicitud = outcome.Data.IdSolicitud },
                    outcome.Data);
            }

            return Ok(outcome.Data);
        }

        if (outcome.StatusCode == StatusCodes.Status400BadRequest)
        {
            return this.ValidationError(
                outcome.ErrorDetail ?? "Solicitud de estimación inválida.",
                outcome.ValidationField ?? string.Empty);
        }

        return Problem(
            statusCode: outcome.StatusCode,
            title: outcome.ErrorTitle ?? "Error en el procesamiento de estimación.",
            detail: outcome.ErrorDetail);
    }
}
