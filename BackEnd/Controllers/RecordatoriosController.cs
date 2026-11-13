using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/recordatorios")]
public sealed class RecordatoriosController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public Task<List<Recordatorio>> GetAll(CancellationToken ct) =>
        db.Recordatorios.AsNoTracking().ToListAsync(ct);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Recordatorio>> Get(int id, CancellationToken ct) =>
        await db.Recordatorios.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();

    [HttpPost]
    public async Task<ActionResult<Recordatorio>> Create(Recordatorio item, CancellationToken ct)
    {
        var validationError = await ValidateRegla12Async(item, ct);
        if (validationError is not null) return validationError;

        item.IdRecordatorio = 0;
        item.CreadoEn = DateTime.UtcNow;
        item.VersionRegistro = 1;
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

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, Recordatorio input, CancellationToken ct)
    {
        var validationError = await ValidateRegla12Async(input, ct);
        if (validationError is not null) return validationError;

        var item = await db.Recordatorios.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdRancho = input.IdRancho;
        item.IdAnimal = input.IdAnimal;
        item.IdLote = input.IdLote;
        item.IdTratamiento = input.IdTratamiento;
        item.IdResponsable = input.IdResponsable;
        item.Tipo = input.Tipo;
        item.Descripcion = input.Descripcion;
        item.FechaProgramada = input.FechaProgramada;
        item.Estado = input.Estado;
        item.FechaCompletado = string.Equals(input.Estado, "Completado", StringComparison.OrdinalIgnoreCase)
            ? (input.FechaCompletado ?? item.FechaCompletado ?? DateTime.UtcNow)
            : input.FechaCompletado;
        item.IdAutor = input.IdAutor;
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

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.Recordatorios.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.Recordatorios.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo eliminar el recordatorio por una restricción de datos.");
        }

        return NoContent();
    }

    private async Task<BadRequestObjectResult?> ValidateRegla12Async(Recordatorio item, CancellationToken ct)
    {
        // Regla 12: Recordatorio puede ser general del rancho, individual o por lote; animal y lote son excluyentes.
        if (item.IdAnimal.HasValue && item.IdLote.HasValue)
            return BadRequest("El recordatorio puede ser general del rancho, individual o por lote; animal y lote son excluyentes.");

        if (item.IdTratamiento.HasValue)
        {
            if (item.IdLote.HasValue)
                return BadRequest("Un recordatorio vinculado a un tratamiento individual no puede asignarse a un lote.");

            var tratamiento = await db.Tratamientos.AsNoTracking()
                .SingleOrDefaultAsync(t => t.IdTratamiento == item.IdTratamiento.Value, ct);
            if (tratamiento is not null)
            {
                var evento = await db.EventosSanitarios.AsNoTracking()
                    .SingleOrDefaultAsync(e => e.IdEventoSanitario == tratamiento.IdEventoSanitario, ct);
                if (evento is not null && item.IdAnimal.HasValue && item.IdAnimal.Value != evento.IdAnimal)
                    return BadRequest("El tratamiento debe corresponder al animal indicado en el recordatorio.");
            }
        }

        return null;
    }
}
