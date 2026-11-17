using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/recordatorios")]
public sealed class RecordatoriosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<Recordatorio>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Recordatorios.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        return query.ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Recordatorio>> Get(Guid id, CancellationToken ct) =>
        await db.Recordatorios.AsNoTracking().FirstOrDefaultAsync(r => r.IdRecordatorio == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<Recordatorio>> Create(Recordatorio item, CancellationToken ct)
    {
        if (item.IdRecordatorio == Guid.Empty)
            item.IdRecordatorio = Guid.NewGuid();

        var existing = await db.Recordatorios.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRecordatorio == item.IdRecordatorio, ct);
        if (existing is not null)
            return Ok(existing);

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, item.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateRecordatorioAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAutor = authorId;
        item.Tipo = item.Tipo.Trim();
        item.Descripcion = item.Descripcion.Trim();
        item.Estado = item.Estado.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;
        if (item.FechaProgramada == default) item.FechaProgramada = DateTime.UtcNow;
        if (string.Equals(item.Estado, "Completado", StringComparison.OrdinalIgnoreCase) && item.FechaCompletado is null)
            item.FechaCompletado = DateTime.UtcNow;

        db.Recordatorios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el recordatorio; verifica que el rancho y las referencias existan.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdRecordatorio }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Recordatorio input, CancellationToken ct)
    {
        var item = await db.Recordatorios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, input.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateRecordatorioAsync(input, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdRancho = input.IdRancho;
        item.IdAnimal = input.IdAnimal;
        item.IdLote = input.IdLote;
        item.IdTratamiento = input.IdTratamiento;
        item.IdResponsable = input.IdResponsable;
        item.Tipo = input.Tipo.Trim();
        item.Descripcion = input.Descripcion.Trim();
        item.FechaProgramada = input.FechaProgramada;
        item.Estado = input.Estado.Trim();
        item.FechaCompletado = string.Equals(input.Estado, "Completado", StringComparison.OrdinalIgnoreCase)
            ? (input.FechaCompletado ?? item.FechaCompletado ?? DateTime.UtcNow)
            : input.FechaCompletado;
        item.IdAutor = authorId;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar el recordatorio; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Recordatorios.FindAsync([id], ct);
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