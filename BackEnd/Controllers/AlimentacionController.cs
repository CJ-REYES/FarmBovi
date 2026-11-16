using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/alimentacion")]
public sealed class AlimentacionController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<Alimentacion>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Alimentaciones.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        return query.ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Alimentacion>> Get(Guid id, CancellationToken ct) =>
        await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<Alimentacion>> Create(AlimentacionCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdAlimentacion is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct);
        if (existing is not null)
            return Ok(existing);

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var inicio = dto.Inicio == default ? DateTime.UtcNow : dto.Inicio;
        var validationError = await validator.ValidateAlimentacionAsync(dto.IdAnimal, dto.IdLote, dto.Cantidad, inicio, dto.Fin, ct);
        if (validationError is not null) return BadRequest(validationError);

        var alimentacion = new Alimentacion
        {
            IdAlimentacion = id,
            IdAnimal = dto.IdAnimal,
            IdLote = dto.IdLote,
            Alimento = dto.Alimento.Trim(),
            Racion = dto.Racion.Trim(),
            Cantidad = dto.Cantidad,
            Unidad = dto.Unidad.Trim(),
            Frecuencia = dto.Frecuencia.Trim(),
            Inicio = inicio,
            Fin = dto.Fin,
            CambioDieta = dto.CambioDieta,
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Alimentaciones.Add(alimentacion);
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo registrar la alimentación; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = alimentacion.IdAlimentacion }, alimentacion);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, AlimentacionUpdateDto dto, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateAlimentacionAsync(dto.IdAnimal, dto.IdLote, dto.Cantidad, dto.Inicio, dto.Fin, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAnimal = dto.IdAnimal;
        item.IdLote = dto.IdLote;
        item.Alimento = dto.Alimento.Trim();
        item.Racion = dto.Racion.Trim();
        item.Cantidad = dto.Cantidad;
        item.Unidad = dto.Unidad.Trim();
        item.Frecuencia = dto.Frecuencia.Trim();
        item.Inicio = dto.Inicio;
        item.Fin = dto.Fin;
        item.CambioDieta = dto.CambioDieta;
        item.IdAutor = authorId;
        item.EliminadoEn = dto.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo actualizar la alimentación; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Alimentaciones.FindAsync([id], ct);
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
