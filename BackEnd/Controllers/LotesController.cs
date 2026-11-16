using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/lotes")]
public sealed class LotesController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<Lote>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Lotes.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(l => l.EliminadoEn == null);

        return query.ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Lote>> Get(Guid id, CancellationToken ct) =>
        await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<Lote>> Create(Lote item, CancellationToken ct)
    {
        if (item.IdLote == Guid.Empty)
            item.IdLote = Guid.NewGuid();

        var existing = await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == item.IdLote, ct);
        if (existing is not null)
            return Ok(existing);

        if (item.IdRancho == Guid.Empty || string.IsNullOrWhiteSpace(item.Nombre) || string.IsNullOrWhiteSpace(item.Estado))
            return BadRequest("IdRancho, nombre y estado del lote son obligatorios.");

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, item.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var ranchoExists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == item.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists) return BadRequest("El rancho especificado no existe o está eliminado.");

        item.IdAutor = authorId;
        item.Nombre = item.Nombre.Trim();
        item.Estado = item.Estado.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Lotes.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdLote }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Lote input, CancellationToken ct)
    {
        var item = await db.Lotes.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, input.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        item.IdRancho = input.IdRancho;
        item.Nombre = input.Nombre.Trim();
        item.Ubicacion = input.Ubicacion;
        item.Estado = input.Estado.Trim();
        item.IdAutor = authorId;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Lotes.FindAsync([id], ct);
        if (item is null) return NotFound();

        var hasActiveAnimals = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdLote == id && a.EliminadoEn == null, ct);
        if (hasActiveAnimals)
            return Conflict("No se puede eliminar un lote que tiene animales activos asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}
