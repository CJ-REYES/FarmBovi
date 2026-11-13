using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/pesajes")]
public sealed class PesajesController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<Pesaje>>> GetAll([FromQuery] int? idRancho, CancellationToken ct)
    {
        var query = db.Pesajes
            .AsNoTracking()
            .Where(p => p.EliminadoEn == null);

        if (idRancho.HasValue)
        {
            int r = idRancho.Value;
            query = query.Where(p => db.Animales.Any(an => an.IdAnimal.ToString() == p.IdAnimal.ToString() && an.IdRancho == r));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Pesaje>> Get(int id, CancellationToken ct)
    {
        var item = await db.Pesajes.FindAsync([id], ct);
        return item is not null ? Ok(item) : NotFound();
    }

    [HttpPost]
    public async Task<ActionResult<Pesaje>> Create(Pesaje item, CancellationToken ct)
    {
        item.IdPesaje = 0;
        item.FechaCreacion = DateTime.UtcNow;

        db.Pesajes.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el pesaje, verifique la referencia del animal."); 
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdPesaje }, item);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, Pesaje input, CancellationToken ct)
    {
        var item = await db.Pesajes.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.Peso = input.Peso;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro de pesaje."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.Pesajes.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.Pesajes.Remove(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo eliminar el pesaje debido a restricciones de datos."); 
        }

        return NoContent();
    }
}