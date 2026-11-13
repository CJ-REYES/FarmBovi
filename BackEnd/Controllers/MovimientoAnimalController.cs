using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/movimientos-animales")]
public sealed class MovimientoAnimalController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<MovimientoAnimal>>> GetAll([FromQuery] int? idRancho, CancellationToken ct)
    {
        var query = db.MovimientosAnimales
            .AsNoTracking()
            .Where(m => m.EliminadoEn == null);

        if (idRancho.HasValue)
        {
            int r = idRancho.Value;
            query = query.Where(m => db.Animales.Any(an => an.IdAnimal.ToString() == m.IdAnimal.ToString() && an.IdRancho == r));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<MovimientoAnimal>> Get(int id, CancellationToken ct)
    {
        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        return item is not null ? Ok(item) : NotFound();
    }

    [HttpPost]
    public async Task<ActionResult<MovimientoAnimal>> Create(MovimientoAnimalCreateDto dto, CancellationToken ct)
    {
        var movimiento = new MovimientoAnimal
        {
            IdAnimal = dto.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo,
            Fecha = dto.Fecha,
            OrigenExterno = dto.OrigenExterno,
            DestinoExterno = dto.DestinoExterno,
            Motivo = dto.Motivo,
            IdAutor = dto.IdAutor
        };

        db.MovimientosAnimales.Add(movimiento);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el movimiento, verifique las referencias del animal o lotes."); 
        }

        return CreatedAtAction(nameof(Get), new { id = movimiento.IdMovimiento }, movimiento);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, MovimientoAnimalCreateDto input, CancellationToken ct)
    {
        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.IdLoteOrigen = input.IdLoteOrigen;
        item.IdLoteDestino = input.IdLoteDestino;
        item.Tipo = input.Tipo;
        item.Fecha = input.Fecha;
        item.OrigenExterno = input.OrigenExterno;
        item.DestinoExterno = input.DestinoExterno;
        item.Motivo = input.Motivo;
        item.IdAutor = input.IdAutor;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro de movimiento."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.MovimientosAnimales.Remove(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo eliminar el movimiento debido a restricciones de datos."); 
        }

        return NoContent();
    }
}