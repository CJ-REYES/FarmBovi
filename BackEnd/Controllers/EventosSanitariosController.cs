using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/eventos-sanitarios")]
public sealed class EventosSanitariosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<EventoSanitario>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.EventosSanitarios.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(e => e.EliminadoEn == null);

        return query.ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<EventoSanitario>> Get(Guid id, CancellationToken ct) =>
        await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<EventoSanitario>> Create(EventoSanitario item, CancellationToken ct)
    {
        if (item.IdEventoSanitario == Guid.Empty)
            item.IdEventoSanitario = Guid.NewGuid();

        var existing = await db.EventosSanitarios.AsNoTracking()
            .FirstOrDefaultAsync(e => e.IdEventoSanitario == item.IdEventoSanitario, ct);
        if (existing is not null)
            return Ok(existing);

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, item.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateEventoSanitarioAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAutor = authorId;
        item.Tipo = item.Tipo.Trim();
        item.Responsable = item.Responsable.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;
        if (item.Fecha == default) item.Fecha = DateTime.UtcNow;

        db.EventosSanitarios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el evento sanitario; verifica que el animal exista.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdEventoSanitario }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, EventoSanitario input, CancellationToken ct)
    {
        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, input.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateEventoSanitarioAsync(input, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAnimal = input.IdAnimal;
        item.Tipo = input.Tipo.Trim();
        item.Fecha = input.Fecha;
        item.Sintomas = input.Sintomas;
        item.Diagnostico = input.Diagnostico;
        item.ProfesionalDiagnostico = input.ProfesionalDiagnostico;
        item.EvidenciaDiagnosticoUri = input.EvidenciaDiagnosticoUri;
        item.Responsable = input.Responsable.Trim();
        item.Observaciones = input.Observaciones;
        item.IdAutor = authorId;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar el evento sanitario; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var hasActiveTratamientos = await db.Tratamientos.AsNoTracking()
            .AnyAsync(t => t.IdEventoSanitario == id && t.EliminadoEn == null, ct);
        if (hasActiveTratamientos)
            return Conflict("No se puede eliminar un evento sanitario que tiene tratamientos asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}