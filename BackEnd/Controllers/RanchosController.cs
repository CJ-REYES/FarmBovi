using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController, Route("api/ranchos")]
public sealed class RanchosController(FarmDbContext db) : ControllerBase
{
    [HttpGet] public Task<List<Rancho>> GetAll(CancellationToken ct) => db.Ranchos.AsNoTracking().ToListAsync(ct);
    [HttpGet("{id:int}")] public async Task<ActionResult<Rancho>> Get(int id, CancellationToken ct) => await db.Ranchos.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();
    [HttpPost] public async Task<ActionResult<Rancho>> Create(Rancho item, CancellationToken ct) { item.IdRancho=0; item.CreadoEn=DateTime.UtcNow; item.VersionRegistro=1; db.Ranchos.Add(item); try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("No se pudo crear el rancho."); } return CreatedAtAction(nameof(Get), new { id=item.IdRancho }, item); }
    [HttpPut("{id:int}")] public async Task<IActionResult> Update(int id, Rancho input, CancellationToken ct) { var item=await db.Ranchos.FindAsync([id],ct); if(item is null)return NotFound(); item.Nombre=input.Nombre; item.UbicacionGeneral=input.UbicacionGeneral; item.Estado=input.Estado; item.IdAutor=input.IdAutor; item.EliminadoEn=input.EliminadoEn; item.VersionRegistro++; try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("No se pudo actualizar el rancho."); } return NoContent(); }
    [HttpDelete("{id:int}")] public async Task<IActionResult> Delete(int id, CancellationToken ct) { var item=await db.Ranchos.FindAsync([id],ct); if(item is null)return NotFound(); db.Ranchos.Remove(item); try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("No se puede eliminar un rancho que tiene lotes, animales o usuarios asociados."); } return NoContent(); }
}
