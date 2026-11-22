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
public sealed class MovimientoAnimalController(
    FarmDbContext db,
    FarmDomainValidationService validator,
    RanchAccessService access) : ControllerBase
{
    private async Task<(Guid? RanchId, IActionResult? Error)> ResolveAnimalRanchAsync(
        int userId,
        Guid idAnimal,
        CancellationToken ct)
    {
        if (idAnimal == Guid.Empty)
            return (null, BadRequest("El campo idAnimal es obligatorio."));

        var idRancho = await db.Animales.AsNoTracking()
            .Where(a => a.IdAnimal == idAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRancho.HasValue || idRancho.Value == Guid.Empty)
            return (null, BadRequest("El animal indicado no existe."));

        if (!await access.CanAccessAsync(userId, idRancho.Value, ct))
            return (null, Forbid());

        return (idRancho.Value, null);
    }

    [HttpGet]
    public async Task<ActionResult<List<MovimientoAnimal>>> GetAll(
        [FromQuery] Guid? idRancho,
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

        var lista = await query.OrderBy(m => m.Fecha).ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (error is not null) return error;

        return Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Create(MovimientoAnimalCreateDto dto, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (_, ranchError) = await ResolveAnimalRanchAsync(userId.Value, dto.IdAnimal, ct);
        if (ranchError is not null) return ranchError;

        var id = dto.IdMovimiento is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (existing is not null)
            return Ok(existing);

        int authorId = userId.Value;

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var movimiento = new MovimientoAnimal
        {
            IdMovimiento = id,
            IdAnimal = dto.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo.Trim(),
            Fecha = dto.Fecha == default ? DateTime.UtcNow : dto.Fecha,
            OrigenExterno = dto.OrigenExterno,
            DestinoExterno = dto.DestinoExterno,
            Motivo = dto.Motivo,
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var (animal, validationError) = await validator.ValidateAndPrepareMovimientoAsync(movimiento, ct);
        if (validationError is not null || animal is null)
        {
            await tx.RollbackAsync(ct);
            return BadRequest(validationError);
        }

        var tipoNorm = movimiento.Tipo;
        if (movimiento.IdLoteDestino.HasValue &&
            (tipoNorm.Equals("Alta", StringComparison.OrdinalIgnoreCase) ||
             tipoNorm.Equals("CambioInterno", StringComparison.OrdinalIgnoreCase) ||
             tipoNorm.Equals("Cambio interno", StringComparison.OrdinalIgnoreCase)))
        {
            animal.IdLote = movimiento.IdLoteDestino;
            animal.VersionRegistro++;
        }
        else if (tipoNorm.Equals("Venta", StringComparison.OrdinalIgnoreCase) ||
                 tipoNorm.Equals("Baja", StringComparison.OrdinalIgnoreCase))
        {
            animal.Estado = tipoNorm.Equals("Venta", StringComparison.OrdinalIgnoreCase) ? "Vendido" : "Baja";
            animal.FechaSalida = movimiento.Fecha.Date;
            animal.VersionRegistro++;
        }

        db.MovimientosAnimales.Add(movimiento);

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo registrar el movimiento; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = movimiento.IdMovimiento }, movimiento);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, MovimientoAnimalUpdateDto dto, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null)
        {
            await tx.RollbackAsync(ct);
            return NotFound();
        }

        var (currentRanchId, currentError) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (currentError is not null)
        {
            await tx.RollbackAsync(ct);
            return currentError;
        }

        var (newRanchId, newError) = await ResolveAnimalRanchAsync(userId.Value, dto.IdAnimal, ct);
        if (newError is not null)
        {
            await tx.RollbackAsync(ct);
            return newError;
        }

        if (currentRanchId != newRanchId)
        {
            await tx.RollbackAsync(ct);
            return BadRequest("No se puede reasignar el movimiento a un animal de otro rancho.");
        }

        int authorId = userId.Value;

        item.IdAnimal = dto.IdAnimal;
        item.IdLoteOrigen = dto.IdLoteOrigen;
        item.IdLoteDestino = dto.IdLoteDestino;
        item.Tipo = dto.Tipo.Trim();
        item.Fecha = dto.Fecha;
        item.OrigenExterno = dto.OrigenExterno;
        item.DestinoExterno = dto.DestinoExterno;
        item.Motivo = dto.Motivo;
        item.IdAutor = authorId;
        item.EliminadoEn = dto.EliminadoEn;
        item.VersionRegistro++;

        var (_, validationError) = await validator.ValidateAndPrepareMovimientoAsync(item, ct);
        if (validationError is not null)
        {
            await tx.RollbackAsync(ct);
            return BadRequest(validationError);
        }

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo actualizar el movimiento; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

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
}
