using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/alimentacion")]
public sealed class AlimentacionController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<Alimentacion>>> GetAll([FromQuery] int? idRancho, CancellationToken ct)
    {
        var query = db.Alimentaciones
            .AsNoTracking()
            .Where(a => a.EliminadoEn == null);

        if (idRancho.HasValue)
        {
            int r = idRancho.Value;
            
            // Solución definitiva: filtramos usando los IDs convertidos/mapeados de forma segura
            query = query.Where(a => 
                (!string.IsNullOrEmpty(a.IdLote) && db.Lotes.Any(lote => lote.IdLote.ToString() == a.IdLote && lote.IdRancho == r)) ||
                (!string.IsNullOrEmpty(a.IdAnimal) && db.Animales.Any(animal => animal.IdAnimal.ToString() == a.IdAnimal && animal.IdRancho == r))
            );
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Alimentacion>> Get(int id, CancellationToken ct)
    {
        var item = await db.Alimentaciones.FindAsync([id], ct);
        return item is not null ? Ok(item) : NotFound();
    }

    [HttpPost]
    public async Task<ActionResult<Alimentacion>> Create(AlimentacionCreateDto dto, CancellationToken ct)
    {
        var alimentacion = new Alimentacion
        {
            IdAnimal = dto.IdAnimal,
            IdLote = dto.IdLote,
            Alimento = dto.Alimento,
            Racion = dto.Racion,
            Cantidad = dto.Cantidad,
            Unidad = dto.Unidad,
            Frecuencia = dto.Frecuencia,
            Inicio = dto.Inicio,
            Fin = dto.Fin,
            CambioDieta = dto.CambioDieta,
            IdAutor = dto.IdAutor
        };

        db.Alimentaciones.Add(alimentacion);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar la alimentación, verifique las referencias."); 
        }

        return CreatedAtAction(nameof(Get), new { id = alimentacion.IdAlimentacion }, alimentacion);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, AlimentacionCreateDto input, CancellationToken ct)
    {
        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.IdLote = input.IdLote;
        item.Alimento = input.Alimento;
        item.Racion = input.Racion;
        item.Cantidad = input.Cantidad;
        item.Unidad = input.Unidad;
        item.Frecuencia = input.Frecuencia;
        item.Inicio = input.Inicio;
        item.Fin = input.Fin;
        item.CambioDieta = input.CambioDieta;
        item.IdAutor = input.IdAutor;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro de alimentación."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.Alimentaciones.Remove(item);

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