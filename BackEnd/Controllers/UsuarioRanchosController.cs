using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController, Route("api/usuario-ranchos")]
public sealed class UsuarioRanchosController(FarmDbContext db) : ControllerBase
{
    [HttpGet] public Task<List<UsuarioRancho>> GetAll(CancellationToken ct) => db.UsuarioRanchos.AsNoTracking().ToListAsync(ct);
    [HttpGet("{id:int}")] public async Task<ActionResult<UsuarioRancho>> Get(int id, CancellationToken ct) => await db.UsuarioRanchos.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();
    [HttpPost] public async Task<ActionResult<UsuarioRancho>> Create(UsuarioRancho item, CancellationToken ct) { item.IdUsuarioRancho=0; item.FechaAlta=DateTime.UtcNow; db.UsuarioRanchos.Add(item); try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("La asignación ya existe o el usuario/ranchos no existen."); } return CreatedAtAction(nameof(Get), new { id=item.IdUsuarioRancho }, item); }
    [HttpPut("{id:int}")] public async Task<IActionResult> Update(int id, UsuarioRancho input, CancellationToken ct) { var item=await db.UsuarioRanchos.FindAsync([id],ct); if(item is null)return NotFound(); item.IdUsuario=input.IdUsuario; item.IdRancho=input.IdRancho; item.Rol=input.Rol; item.Estado=input.Estado; item.FechaBaja=input.FechaBaja; try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("La asignación ya existe o el usuario/ranchos no existen."); } return NoContent(); }
    [HttpDelete("{id:int}")] public async Task<IActionResult> Delete(int id, CancellationToken ct) { var item=await db.UsuarioRanchos.FindAsync([id],ct); if(item is null)return NotFound(); db.UsuarioRanchos.Remove(item); await db.SaveChangesAsync(ct); return NoContent(); }
}
