using FarmBovi.Api.DTOs;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/genealogia")]
public sealed class GenealogiaController(GenealogiaService genealogia) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Registrar([FromBody] RegistrarGenealogiaRequest request, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return Unauthorized();

        var result = await genealogia.RegistrarAsync(request, userId, ct);
        return ToActionResult(result, createdAtAction: nameof(ObtenerPadres), routeValues: new { idAnimal = request.IdAnimal });
    }

    [HttpPut("{idAnimal:guid}")]
    public async Task<IActionResult> Actualizar(Guid idAnimal, [FromBody] ActualizarGenealogiaRequest request, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return Unauthorized();

        var result = await genealogia.ActualizarAsync(idAnimal, request, userId, ct);
        return ToActionResult(result);
    }

    [HttpDelete("{idAnimal:guid}")]
    public async Task<IActionResult> Eliminar(Guid idAnimal, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return Unauthorized();

        var result = await genealogia.EliminarAsync(idAnimal, userId, ct);
        if (result.Status == GenealogiaOperationStatus.Success)
            return NoContent();

        return ToActionResult(result);
    }

    [HttpGet("{idAnimal:guid}/padres")]
    public async Task<IActionResult> ObtenerPadres(Guid idAnimal, [FromQuery] int profundidad = 1, CancellationToken ct = default)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return Unauthorized();

        var result = await genealogia.ObtenerPadresAsync(idAnimal, profundidad, userId, ct);
        return ToActionResult(result);
    }

    [HttpGet("{idAnimal:guid}/descendientes")]
    public async Task<IActionResult> ObtenerDescendientes(Guid idAnimal, [FromQuery] int profundidad = 1, CancellationToken ct = default)
    {
        if (RanchAccessService.GetUserId(User) is not { } userId)
            return Unauthorized();

        var result = await genealogia.ObtenerDescendientesAsync(idAnimal, profundidad, userId, ct);
        return ToActionResult(result);
    }

    private IActionResult ToActionResult<T>(
        GenealogiaOperationResult<T> result,
        string? createdAtAction = null,
        object? routeValues = null) =>
        result.Status switch
        {
            GenealogiaOperationStatus.Success when createdAtAction is not null => CreatedAtAction(createdAtAction, routeValues, result.Data),
            GenealogiaOperationStatus.Success => Ok(result.Data),
            GenealogiaOperationStatus.BadRequest => BadRequest(new { mensaje = result.Error }),
            GenealogiaOperationStatus.NotFound => NotFound(new { mensaje = result.Error }),
            GenealogiaOperationStatus.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { mensaje = result.Error }),
            GenealogiaOperationStatus.Conflict => Conflict(new { mensaje = result.Error }),
            _ => BadRequest(new { mensaje = result.Error })
        };
}
