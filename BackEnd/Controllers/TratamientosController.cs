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

        if (item.FechaInicio == default) item.FechaInicio = DateTime.UtcNow;

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, item.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateTratamientoAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAutor = authorId;
        item.Producto = item.Producto.Trim();
        item.UnidadDosis = item.UnidadDosis.Trim();
        item.Frecuencia = item.Frecuencia.Trim();
        item.Responsable = item.Responsable.Trim();
        item.Estado = item.Estado.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Tratamientos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el tratamiento; verifica que el evento sanitario exista.");
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
        item.Producto = input.Producto.Trim();
        item.Dosis = input.Dosis;
        item.UnidadDosis = input.UnidadDosis.Trim();
        item.ViaAdministracion = input.ViaAdministracion;
        item.Frecuencia = input.Frecuencia.Trim();
        item.FechaInicio = input.FechaInicio;
        item.FechaFin = input.FechaFin;
        item.Responsable = input.Responsable.Trim();
        item.PrescripcionUri = input.PrescripcionUri;
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
            return Conflict("No se pudo actualizar el tratamiento; verifica las referencias.");
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
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}
