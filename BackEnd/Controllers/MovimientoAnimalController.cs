using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/movimientos-animales")]
[RanchScope(RanchResource.MovimientoAnimal)]
public sealed class MovimientoAnimalController(
    FarmDbContext db,
    FarmDomainValidationService validator,
    RanchAccessService access) : ControllerBase
{
    private ActionResult ToActionResult(IActionResult result) => result switch
    {
        ObjectResult objectResult => StatusCode(objectResult.StatusCode ?? StatusCodes.Status400BadRequest, objectResult.Value),
        StatusCodeResult statusCodeResult => StatusCode(statusCodeResult.StatusCode),
        _ => BadRequest(result)
    };

    private async Task<(Guid? RanchId, IActionResult? Error)> ResolveAnimalRanchAsync(
        int userId,
        Guid idAnimal,
        CancellationToken ct)
    {
        if (idAnimal == Guid.Empty)
            return (null, this.ValidationError("El campo idAnimal es obligatorio.", nameof(idAnimal)));

        var idRancho = await db.Animales.AsNoTracking()
            .Where(a => a.IdAnimal == idAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRancho.HasValue || idRancho.Value == Guid.Empty)
            return (null, this.ValidationError("El animal indicado no existe.", nameof(idAnimal)));

        if (!await access.CanAccessAsync(userId, idRancho.Value, ct))
            return (null, Forbid());

        return (idRancho.Value, null);
    }

    [HttpGet]
    [ProducesResponseType(typeof(List<MovimientoAnimalResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<MovimientoAnimalResponseDto>>> GetAll(
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.MovimientosAnimales.AsNoTracking()
            .Where(m => db.Animales.Any(a => a.IdAnimal == m.IdAnimal && ranchosAutorizadosIds.Contains(a.IdRancho)));

        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(m => db.Animales.Any(a => a.IdAnimal == m.IdAnimal && a.IdRancho == idRancho.Value));
        }

        var items = await query.OrderBy(m => m.Fecha).ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(MovimientoAnimalResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<MovimientoAnimalResponseDto>> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (item is null) return this.NotFoundProblem("El movimiento de animal solicitado no existe.");

        var (_, error) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (error is not null) return ToActionResult(error);

        return Ok(ToResponseDto(item));
    }

    [HttpPost]
    [ProducesResponseType(typeof(MovimientoAnimalResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(MovimientoAnimalResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<MovimientoAnimalResponseDto>> Create(
        MovimientoAnimalCreateDto dto,
        CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (_, ranchError) = await ResolveAnimalRanchAsync(userId.Value, dto.IdAnimal, ct);
        if (ranchError is not null) return ToActionResult(ranchError);

        var id = dto.IdMovimiento is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor > 0 ? dto.IdAutor : userId.Value, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var item = new MovimientoAnimal
        {
            IdMovimiento = id,
            IdAnimal = dto.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtcDate(dto.Fecha),
            OrigenExterno = dto.OrigenExterno?.Trim(),
            DestinoExterno = dto.DestinoExterno?.Trim(),
            Motivo = dto.Motivo?.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var (_, validationError) = await validator.ValidateAndPrepareMovimientoAsync(item, ct);
        if (validationError is not null)
            return this.ValidationError(validationError);

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        db.MovimientosAnimales.Add(item);

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return this.ConflictProblem("No se pudo guardar el movimiento por conflicto de identificador o referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdMovimiento }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, MovimientoAnimalUpdateDto dto, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El movimiento de animal solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un movimiento eliminado.");

        var (currentRanchId, currentError) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (currentError is not null) return currentError;

        var (newRanchId, newError) = await ResolveAnimalRanchAsync(userId.Value, dto.IdAnimal, ct);
        if (newError is not null) return newError;

        if (currentRanchId != newRanchId)
            return this.ValidationError("No se puede reasignar el movimiento a un animal de otro rancho.", nameof(dto.IdAnimal));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor > 0 ? dto.IdAutor : userId.Value, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        item.IdAnimal = dto.IdAnimal;
        item.IdLoteOrigen = dto.IdLoteOrigen;
        item.IdLoteDestino = dto.IdLoteDestino;
        item.Tipo = dto.Tipo.Trim();
        item.Fecha = ApiProblemResults.EnsureUtcDate(dto.Fecha);
        item.OrigenExterno = dto.OrigenExterno?.Trim();
        item.DestinoExterno = dto.DestinoExterno?.Trim();
        item.Motivo = dto.Motivo?.Trim();
        item.IdAutor = authorId;
        item.VersionRegistro++;

        var (_, validationError) = await validator.ValidateAndPrepareMovimientoAsync(item, ct);
        if (validationError is not null)
            return this.ValidationError(validationError);

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return this.ConflictProblem("No se pudo actualizar el movimiento por conflicto de referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El movimiento de animal solicitado no existe.");

        var (_, error) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (error is not null) return error;

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    internal static MovimientoAnimalResponseDto ToResponseDto(MovimientoAnimal m) => new()
    {
        IdMovimiento = m.IdMovimiento,
        IdAnimal = m.IdAnimal,
        IdLoteOrigen = m.IdLoteOrigen,
        IdLoteDestino = m.IdLoteDestino,
        Tipo = m.Tipo,
        Fecha = m.Fecha,
        OrigenExterno = m.OrigenExterno,
        DestinoExterno = m.DestinoExterno,
        Motivo = m.Motivo,
        IdAutor = m.IdAutor,
        CreadoEn = m.CreadoEn,
        VersionRegistro = m.VersionRegistro,
        EliminadoEn = m.EliminadoEn
    };
}
