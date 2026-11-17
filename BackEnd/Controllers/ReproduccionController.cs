using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/reproduccion")]
[Route("api/reproduction")]
public sealed class ReproduccionController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<Reproduccion>>> GetAll([FromQuery] Guid? idRancho, CancellationToken ct)
    {
        var query = db.Reproduccion
            .AsNoTracking()
            .Where(r => r.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            var ranchoId = idRancho.Value;
            query = query.Where(item => db.Animales.Any(an => an.IdAnimal == item.IdAnimal && an.IdRancho == ranchoId));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Reproduccion>> Get(Guid id, CancellationToken ct)
    {
        var item = await db.Reproduccion.FindAsync([id], ct);
        return item is not null ? Ok(item) : NotFound();
    }

    [HttpPost]
    public async Task<ActionResult<Reproduccion>> Create(Reproduccion item, CancellationToken ct)
    {
        if (item.IdReproduccion == Guid.Empty)
            item.IdReproduccion = Guid.NewGuid();

        if (item.FechaCreacion == default)
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

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Reproduccion input, CancellationToken ct)
    {
        var item = await db.Reproduccion.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.TipoEvento = input.TipoEvento;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;
        item.VersionRegistro++;

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

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Reproduccion.FindAsync([id], ct);
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