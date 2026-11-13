using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/reproduccion")]
public sealed class ReproduccionController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<Reproduccion>>> GetAll([FromQuery] int? idRancho, CancellationToken ct)
    {
        var query = db.Reproduccion
            .AsNoTracking()
            .Where(r => r.EliminadoEn == null);

        if (idRancho.HasValue)
        {
            int ranchoId = idRancho.Value;
            query = query.Where(item => db.Animales.Any(an => an.IdAnimal.ToString() == item.IdAnimal.ToString() && an.IdRancho == ranchoId));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Reproduccion>> Get(int id, CancellationToken ct)
    {
        var item = await db.Reproduccion.FindAsync([id], ct);
        return item is not null ? Ok(item) : NotFound();
    }

    [HttpPost]
    public async Task<ActionResult<Reproduccion>> Create(Reproduccion item, CancellationToken ct)
    {
        item.IdReproduccion = 0;
        item.FechaCreacion = DateTime.UtcNow;

        db.Reproduccion.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el evento reproductivo, verifique las referencias del animal."); 
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdReproduccion }, item);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, Reproduccion input, CancellationToken ct)
    {
        var item = await db.Reproduccion.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.TipoEvento = input.TipoEvento;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro reproductivo."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.Reproduccion.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.Reproduccion.Remove(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo eliminar el registro debido a restricciones de datos."); 
        }

        return NoContent();
    }
}