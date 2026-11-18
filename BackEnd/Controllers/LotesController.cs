using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/lotes")]
public sealed class LotesController(FarmDbContext db) : ControllerBase
{
    private int? GetCurrentUserId()
    {
        var rawClaim = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue("sub")
            ?? User.FindFirstValue("idUsuario");

        if (!string.IsNullOrWhiteSpace(rawClaim) && int.TryParse(rawClaim, out var userId) && userId > 0)
            return userId;

        return null;
    }

    private async Task<bool> UserHasAccessToRanchoAsync(int userId, Guid idRancho, CancellationToken ct)
    {
        return await db.UsuarioRanchos
            .AnyAsync(ur => ur.IdUsuario == userId && ur.IdRancho == idRancho, ct);
    }

    [HttpGet]
    public async Task<ActionResult<List<Lote>>> GetAll([FromQuery] Guid? idRancho, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.Lotes.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(l => l.EliminadoEn == null);

        query = query.Where(l => ranchosAutorizadosIds.Contains(l.IdRancho));

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid();
            }
            query = query.Where(l => l.IdRancho == idRancho.Value);
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Lote>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == id, ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToRanchoAsync(userId.Value, item.IdRancho, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Lote>> Create(Lote item, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        if (item.IdRancho == Guid.Empty || string.IsNullOrWhiteSpace(item.Nombre) || string.IsNullOrWhiteSpace(item.Estado))
            return BadRequest("IdRancho, nombre y estado del lote son obligatorios.");

        if (!await UserHasAccessToRanchoAsync(userId.Value, item.IdRancho, ct))
        {
            return Forbid();
        }

        if (item.IdLote == Guid.Empty)
            item.IdLote = Guid.NewGuid();

        var existing = await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == item.IdLote, ct);
        if (existing is not null)
            return Ok(existing);

        int authorId = userId.Value;

        var ranchoExists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == item.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists) return BadRequest("El rancho especificado no existe o está eliminado.");

        item.IdAutor = authorId;
        item.Nombre = item.Nombre.Trim();
        item.Estado = item.Estado.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Lotes.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdLote }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Lote input, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Lotes.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToRanchoAsync(userId.Value, item.IdRancho, ct))
        {
            return Forbid();
        }

        if (input.IdRancho != item.IdRancho)
        {
            if (!await UserHasAccessToRanchoAsync(userId.Value, input.IdRancho, ct))
            {
                return Forbid();
            }
        }

        int authorId = userId.Value;

        item.IdRancho = input.IdRancho;
        item.Nombre = input.Nombre.Trim();
        item.Ubicacion = input.Ubicacion;
        item.Estado = input.Estado.Trim();
        item.IdAutor = authorId;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Lotes.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToRanchoAsync(userId.Value, item.IdRancho, ct))
        {
            return Forbid();
        }

        var hasActiveAnimals = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdLote == id && a.EliminadoEn == null, ct);
        if (hasActiveAnimals)
            return Conflict("No se puede eliminar un lote que tiene animales activos asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}