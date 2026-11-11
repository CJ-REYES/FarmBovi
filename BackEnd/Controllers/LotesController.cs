using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController, Route("api/lotes")]
public sealed class LotesController(FarmDbContext db) : ControllerBase
{
    [HttpGet] public Task<List<Lote>> GetAll(CancellationToken ct) => db.Lotes.AsNoTracking().ToListAsync(ct);
    [HttpGet("{id:int}")] public async Task<ActionResult<Lote>> Get(int id, CancellationToken ct) => await db.Lotes.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();
    [HttpPost] public async Task<ActionResult<Lote>> Create(Lote item, CancellationToken ct) { item.IdLote = 0; item.FechaCreacion = DateTime.UtcNow; item.VersionRegistro = 1; db.Lotes.Add(item); try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe."); } return CreatedAtAction(nameof(Get), new { id = item.IdLote }, item); }
    [HttpPut("{id:int}")] public async Task<IActionResult> Update(int id, Lote input, CancellationToken ct) { var item = await db.Lotes.FindAsync([id], ct); if (item is null) return NotFound(); item.IdRancho=input.IdRancho; item.Nombre=input.Nombre; item.Ubicacion=input.Ubicacion; item.Estado=input.Estado; item.IdAutor=input.IdAutor; item.EliminadoEn=input.EliminadoEn; item.VersionRegistro++; try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe."); } return NoContent(); }
    [HttpDelete("{id:int}")] public async Task<IActionResult> Delete(int id, CancellationToken ct) { var item=await db.Lotes.FindAsync([id],ct); if(item is null)return NotFound(); db.Lotes.Remove(item); try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("No se puede eliminar un lote que tiene animales asociados."); } return NoContent(); }
}
