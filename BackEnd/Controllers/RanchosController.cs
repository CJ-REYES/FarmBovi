using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/ranchos")]
public sealed class RanchosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<Rancho>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Ranchos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        return query.ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Rancho>> Get(Guid id, CancellationToken ct) =>
        await db.Ranchos.AsNoTracking().FirstOrDefaultAsync(r => r.IdRancho == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<Rancho>> Create(Rancho item, CancellationToken ct)
    {
        if (item.IdRancho == Guid.Empty)
            item.IdRancho = Guid.NewGuid();

        var existing = await db.Ranchos.AsNoTracking().FirstOrDefaultAsync(r => r.IdRancho == item.IdRancho, ct);
        if (existing is not null)
            return Ok(existing);

        if (string.IsNullOrWhiteSpace(item.Nombre) ||
            string.IsNullOrWhiteSpace(item.UbicacionGeneral) ||
            string.IsNullOrWhiteSpace(item.Estado))
        {
            return BadRequest("Nombre, ubicación general y estado del rancho son obligatorios.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, item.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        item.IdAutor = authorId;
        item.Nombre = item.Nombre.Trim();
        item.UbicacionGeneral = item.UbicacionGeneral.Trim();
        item.Estado = item.Estado.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Ranchos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el rancho.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdRancho }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Rancho input, CancellationToken ct)
    {
        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, input.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        item.Nombre = input.Nombre.Trim();
        item.UbicacionGeneral = input.UbicacionGeneral.Trim();
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
            return Conflict("No se pudo actualizar el rancho.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var hasDependencies =
            await db.Lotes.AsNoTracking().AnyAsync(l => l.IdRancho == id && l.EliminadoEn == null, ct) ||
            await db.Animales.AsNoTracking().AnyAsync(a => a.IdRancho == id && a.EliminadoEn == null, ct) ||
            await db.UsuarioRanchos.AsNoTracking().AnyAsync(ur => ur.IdRancho == id && ur.FechaBaja == null, ct);

        if (hasDependencies)
            return Conflict("No se puede eliminar un rancho que tiene lotes, animales o usuarios asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}
