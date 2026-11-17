using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/usuario-ranchos")]
public sealed class UsuarioRanchosController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public Task<List<UsuarioRancho>> GetAll(CancellationToken ct) =>
        db.UsuarioRanchos.AsNoTracking().ToListAsync(ct);

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<UsuarioRancho>> Get(Guid id, CancellationToken ct) =>
        await db.UsuarioRanchos.AsNoTracking().FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<UsuarioRancho>> Create(UsuarioRancho item, CancellationToken ct)
    {
        if (item.IdUsuarioRancho == Guid.Empty)
            item.IdUsuarioRancho = Guid.NewGuid();

        var existing = await db.UsuarioRanchos.AsNoTracking()
            .FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == item.IdUsuarioRancho, ct);
        if (existing is not null)
            return Ok(existing);

        if (item.IdUsuario == Guid.Empty || item.IdRancho == Guid.Empty ||
            string.IsNullOrWhiteSpace(item.Rol) || string.IsNullOrWhiteSpace(item.Estado))
        {
            return BadRequest("IdUsuario, IdRancho, rol y estado son obligatorios.");
        }

        item.Rol = item.Rol.Trim();
        item.Estado = item.Estado.Trim();
        if (item.FechaAlta == default) item.FechaAlta = DateTime.UtcNow;

        db.UsuarioRanchos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("La asignación ya existe o el usuario/rancho no existen.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdUsuarioRancho }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, UsuarioRancho input, CancellationToken ct)
    {
        var item = await db.UsuarioRanchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdUsuario = input.IdUsuario;
        item.IdRancho = input.IdRancho;
        item.Rol = input.Rol.Trim();
        item.Estado = input.Estado.Trim();
        item.FechaBaja = input.FechaBaja;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("La asignación ya existe o el usuario/rancho no existen.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.UsuarioRanchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.UsuarioRanchos.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo eliminar la asignación usuario-rancho por una restricción de integridad.");
        }

        return NoContent();
    }
}