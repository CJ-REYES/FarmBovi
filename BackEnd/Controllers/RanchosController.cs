using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/ranchos")]
public sealed class RanchosController(FarmDbContext db, RanchAccessService access) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<Rancho>>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.Ranchos.AsNoTracking()
            .Where(r => ranchosAutorizadosIds.Contains(r.IdRancho));

        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Rancho>> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        if (!await access.CanAccessAsync(userId.Value, id, ct))
        {
            var exists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == id, ct);
            return exists ? Forbid() : NotFound();
        }

        var item = await db.Ranchos.AsNoTracking().FirstOrDefaultAsync(r => r.IdRancho == id, ct);
        return item is null ? NotFound() : Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Rancho>> Create(Rancho item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        if (string.IsNullOrWhiteSpace(item.Nombre) ||
            string.IsNullOrWhiteSpace(item.UbicacionGeneral) ||
            string.IsNullOrWhiteSpace(item.Estado))
        {
            return BadRequest("Nombre, ubicación general y estado del rancho son obligatorios.");
        }

        item.Nombre = item.Nombre.Trim();
        item.UbicacionGeneral = item.UbicacionGeneral.Trim();
        item.Estado = item.Estado.Trim();

        var nombreExiste = await db.Ranchos
            .AnyAsync(r => r.Nombre == item.Nombre && r.EliminadoEn == null, ct);

        if (nombreExiste)
            return Conflict($"Ya existe un rancho activo con el nombre '{item.Nombre}'.");

        if (item.IdRancho == Guid.Empty)
        {
            item.IdRancho = Guid.NewGuid();
        }
        else
        {
            var idExistente = await db.Ranchos.AnyAsync(r => r.IdRancho == item.IdRancho, ct);
            if (idExistente)
                item.IdRancho = Guid.NewGuid();
        }

        item.IdAutor = userId.Value;
        item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;
        item.EliminadoEn = null;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            db.Ranchos.Add(item);

            var relExists = await db.UsuarioRanchos
                .AnyAsync(ur => ur.IdUsuario == userId.Value && ur.IdRancho == item.IdRancho, ct);

            if (!relExists)
            {
                db.UsuarioRanchos.Add(new UsuarioRancho
                {
                    IdUsuarioRancho = Guid.NewGuid(),
                    IdUsuario = userId.Value,
                    IdRancho = item.IdRancho,
                    Rol = "Administrador",
                    Estado = "Activo",
                    FechaAlta = DateTime.UtcNow
                });
            }

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            await tx.RollbackAsync(ct);
            var mensajeDetallado = ex.InnerException?.Message ?? ex.Message;
            return Conflict($"No se pudo crear el rancho. Detalle: {mensajeDetallado}");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdRancho }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Rancho input, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        if (!await access.IsAdminAsync(userId.Value, id, ct))
        {
            var exists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == id && r.EliminadoEn == null, ct);
            return exists ? Forbid() : NotFound();
        }

        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null || item.EliminadoEn is not null) return NotFound();

        if (!string.IsNullOrWhiteSpace(input.Nombre)) item.Nombre = input.Nombre.Trim();
        if (!string.IsNullOrWhiteSpace(input.UbicacionGeneral)) item.UbicacionGeneral = input.UbicacionGeneral.Trim();
        if (!string.IsNullOrWhiteSpace(input.Estado)) item.Estado = input.Estado.Trim();
        item.IdAutor = userId.Value;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            var mensajeDetallado = ex.InnerException?.Message ?? ex.Message;
            return Conflict($"No se pudo actualizar el rancho. Detalle: {mensajeDetallado}");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        if (!await access.IsAdminAsync(userId.Value, id, ct))
        {
            var exists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == id && r.EliminadoEn == null, ct);
            return exists ? Forbid() : NotFound();
        }

        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null || item.EliminadoEn is not null) return NotFound();

        var hasDependencies =
            await db.Lotes.AsNoTracking().AnyAsync(l => l.IdRancho == id && l.EliminadoEn == null, ct) ||
            await db.Animales.AsNoTracking().AnyAsync(a => a.IdRancho == id && a.EliminadoEn == null, ct);

        if (hasDependencies)
            return Conflict("No se puede eliminar un rancho que tiene lotes o animales activos asociados.");

        item.EliminadoEn = DateTime.UtcNow;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            var mensajeDetallado = ex.InnerException?.Message ?? ex.Message;
            return Conflict($"No se pudo eliminar el rancho. Detalle: {mensajeDetallado}");
        }

        return NoContent();
    }
}
