using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/tratamientos")]
public sealed class TratamientosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<Tratamiento>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Tratamientos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(t => t.EliminadoEn == null);

        return query.ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Tratamiento>> Get(Guid id, CancellationToken ct) =>
        await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(t => t.IdTratamiento == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<Tratamiento>> Create(Tratamiento item, CancellationToken ct)
    {
        if (item.IdTratamiento == Guid.Empty)
            item.IdTratamiento = Guid.NewGuid();

        var existing = await db.Tratamientos.AsNoTracking()
            .FirstOrDefaultAsync(t => t.IdTratamiento == item.IdTratamiento, ct);
        if (existing is not null)
            return Ok(existing);

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, item.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateTratamientoAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAutor = authorId;
        item.Tipo = item.Tipo.Trim();
        item.Medicamento = item.Medicamento.Trim();
        if (item.Dosis is not null) item.Dosis = item.Dosis.Trim();
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Tratamientos.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el tratamiento, verifique la referencia del evento sanitario."); 
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdTratamiento }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Tratamiento input, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, input.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateTratamientoAsync(input, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdEventoSanitario = input.IdEventoSanitario;
        item.Tipo = input.Tipo.Trim();
        item.Medicamento = input.Medicamento.Trim();
        item.Dosis = input.Dosis?.Trim();
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro de tratamiento."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var hasActiveRecordatorios = await db.Recordatorios.AsNoTracking()
            .AnyAsync(r => r.IdTratamiento == id && r.EliminadoEn == null, ct);
        if (hasActiveRecordatorios)
            return Conflict("No se puede eliminar un tratamiento que tiene recordatorios asociados.");

        if (item.EliminadoEn is null)
        {
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}