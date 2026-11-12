using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/tratamientos")]
public sealed class TratamientosController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public Task<List<Tratamiento>> GetAll(CancellationToken ct) =>
        db.Tratamientos.AsNoTracking().ToListAsync(ct);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Tratamiento>> Get(int id, CancellationToken ct) =>
        await db.Tratamientos.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();

    [HttpPost]
    public async Task<ActionResult<Tratamiento>> Create(Tratamiento item, CancellationToken ct)
    {
        if (item.Dosis <= 0)
            return BadRequest("La dosis del tratamiento debe ser mayor que cero.");
        if (item.FechaFin.HasValue && item.FechaFin.Value < item.FechaInicio)
            return BadRequest("La fecha de fin no puede ser anterior a la fecha de inicio.");

        item.IdTratamiento = 0;
        item.CreadoEn = DateTime.UtcNow;
        item.VersionRegistro = 1;
        if (item.FechaInicio == default) item.FechaInicio = DateTime.UtcNow;

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

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, Tratamiento input, CancellationToken ct)
    {
        if (input.Dosis <= 0)
            return BadRequest("La dosis del tratamiento debe ser mayor que cero.");
        if (input.FechaFin.HasValue && input.FechaFin.Value < input.FechaInicio)
            return BadRequest("La fecha de fin no puede ser anterior a la fecha de inicio.");

        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdEventoSanitario = input.IdEventoSanitario;
        item.Producto = input.Producto;
        item.Dosis = input.Dosis;
        item.UnidadDosis = input.UnidadDosis;
        item.ViaAdministracion = input.ViaAdministracion;
        item.Frecuencia = input.Frecuencia;
        item.FechaInicio = input.FechaInicio;
        item.FechaFin = input.FechaFin;
        item.Responsable = input.Responsable;
        item.PrescripcionUri = input.PrescripcionUri;
        item.Estado = input.Estado;
        item.IdAutor = input.IdAutor;
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

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.Tratamientos.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se puede eliminar un tratamiento que tiene recordatorios asociados.");
        }

        return NoContent();
    }
}
