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
    public async Task<ActionResult<List<Tratamiento>>> GetAll([FromQuery] int? idRancho, CancellationToken ct)
    {
        var query = db.Tratamientos
            .AsNoTracking()
            .Where(t => t.EliminadoEn == null);

        if (idRancho.HasValue)
        {
            int r = idRancho.Value;
            query = query.Where(t => db.Animales.Any(an => an.IdAnimal.ToString() == t.IdAnimal.ToString() && an.IdRancho == r));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Tratamiento>> Get(int id, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        return item is not null ? Ok(item) : NotFound();
    }

    [HttpPost]
    public async Task<ActionResult<Tratamiento>> Create(Tratamiento item, CancellationToken ct)
    {
        item.IdTratamiento = 0;
        item.FechaCreacion = DateTime.UtcNow;

        db.Tratamientos.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el tratamiento, verifique la referencia del animal."); 
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdTratamiento }, item);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, Tratamiento input, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.Tipo = input.Tipo;
        item.Medicamento = input.Medicamento;
        item.Dosis = input.Dosis;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;

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
            return Conflict("No se pudo eliminar el tratamiento debido a restricciones de datos."); 
        }

        return NoContent();
    }
}