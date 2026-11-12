using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/eventos-sanitarios")]
public sealed class EventosSanitariosController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public Task<List<EventoSanitario>> GetAll(CancellationToken ct) =>
        db.EventosSanitarios.AsNoTracking().ToListAsync(ct);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<EventoSanitario>> Get(int id, CancellationToken ct) =>
        await db.EventosSanitarios.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();

    [HttpPost]
    public async Task<ActionResult<EventoSanitario>> Create(EventoSanitario item, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(item.Tipo) || string.IsNullOrWhiteSpace(item.Responsable))
            return BadRequest("El tipo y el responsable del evento sanitario son obligatorios.");

        item.IdEventoSanitario = 0;
        item.CreadoEn = DateTime.UtcNow;
        item.VersionRegistro = 1;
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

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, EventoSanitario input, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(input.Tipo) || string.IsNullOrWhiteSpace(input.Responsable))
            return BadRequest("El tipo y el responsable del evento sanitario son obligatorios.");

        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.Tipo = input.Tipo;
        item.Fecha = input.Fecha;
        item.Sintomas = input.Sintomas;
        item.Diagnostico = input.Diagnostico;
        item.ProfesionalDiagnostico = input.ProfesionalDiagnostico;
        item.EvidenciaDiagnosticoUri = input.EvidenciaDiagnosticoUri;
        item.Responsable = input.Responsable;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;
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

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.EventosSanitarios.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se puede eliminar un evento sanitario que tiene tratamientos asociados.");
        }

        return NoContent();
    }
}
