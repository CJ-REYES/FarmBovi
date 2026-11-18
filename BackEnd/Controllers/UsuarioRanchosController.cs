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
[Route("api/usuario-ranchos")]
public sealed class UsuarioRanchosController(FarmDbContext db) : ControllerBase
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
    public async Task<ActionResult<List<UsuarioRancho>>> GetAll([FromQuery] Guid? idRancho, CancellationToken ct = default)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.UsuarioRanchos.AsNoTracking();

        query = query.Where(ur => ranchosAutorizadosIds.Contains(ur.IdRancho));

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid();
            }
            query = query.Where(ur => ur.IdRancho == idRancho.Value);
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<UsuarioRancho>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.UsuarioRanchos.AsNoTracking().FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToRanchoAsync(userId.Value, item.IdRancho, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<UsuarioRancho>> Create(UsuarioRancho item, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        if (item.IdRancho == Guid.Empty || !await UserHasAccessToRanchoAsync(userId.Value, item.IdRancho, ct))
        {
            return Forbid();
        }

        if (item.IdUsuarioRancho == Guid.Empty)
            item.IdUsuarioRancho = Guid.NewGuid();

        var existing = await db.UsuarioRanchos.AsNoTracking()
            .FirstOrDefaultAsync(ur => ur.IdUsuario == item.IdUsuario && ur.IdRancho == item.IdRancho, ct);
        
        if (existing is not null)
            return Ok(existing);

        if (string.IsNullOrWhiteSpace(item.Rol)) item.Rol = "Operador";
        if (string.IsNullOrWhiteSpace(item.Estado)) item.Estado = "Activo";

        db.UsuarioRanchos.Add(item);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("La asignación del usuario al rancho ya existe o las referencias no son válidas.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdUsuarioRancho }, item);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.UsuarioRanchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToRanchoAsync(userId.Value, item.IdRancho, ct))
        {
            return Forbid();
        }

        db.UsuarioRanchos.Remove(item);
        await db.SaveChangesAsync(ct);

        return NoContent();
    }
}