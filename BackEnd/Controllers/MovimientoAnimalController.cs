using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/movimientos-animales")]
public sealed class MovimientoAnimalController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<MovimientoAnimal>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.MovimientosAnimales.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null);

        return query.OrderBy(m => m.Fecha).ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<MovimientoAnimal>> Get(Guid id, CancellationToken ct) =>
        await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<MovimientoAnimal>> Create(MovimientoAnimalCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdMovimiento is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (existing is not null)
            return Ok(existing);

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

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
            return BadRequest(validationError);

        // Regla 06 y 08: Actualizar ubicación/estado del expediente atómicamente con el movimiento.
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
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

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
        if (validationError is not null) return BadRequest(validationError);

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
        // Regla 06 y 08: Conservar historial de movimientos mediante borrado lógico.
        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}
