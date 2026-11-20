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
[Route("api/alimentacion")]
[Route("api/feeding")]
public sealed class AlimentacionController(FarmDbContext db) : ControllerBase
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

    private async Task<bool> UserHasAccessToAlimentacionAsync(int userId, Alimentacion item, CancellationToken ct)
    {
        if (item.IdAnimal.HasValue)
        {
            var idRancho = await db.Animales
                .Where(a => a.IdAnimal == item.IdAnimal.Value)
                .Select(a => (Guid?)a.IdRancho)
                .FirstOrDefaultAsync(ct);

            if (idRancho.HasValue)
                return await UserHasAccessToRanchoAsync(userId, idRancho.Value, ct);
        }

        if (item.IdLote.HasValue)
        {
            var idRancho = await db.Lotes
                .Where(l => l.IdLote == item.IdLote.Value)
                .Select(l => (Guid?)l.IdRancho)
                .FirstOrDefaultAsync(ct);

            if (idRancho.HasValue)
                return await UserHasAccessToRanchoAsync(userId, idRancho.Value, ct);
        }

        return false;
    }

    [HttpGet]
    public async Task<ActionResult<List<Alimentacion>>> GetAll([FromQuery] Guid? idRancho, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.Alimentaciones.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid();
            }
            query = query.Where(a => 
                (a.IdAnimal.HasValue && db.Animales.Any(an => an.IdAnimal == a.IdAnimal.Value && an.IdRancho == idRancho.Value)) ||
                (a.IdLote.HasValue && db.Lotes.Any(l => l.IdLote == a.IdLote.Value && l.IdRancho == idRancho.Value))
            );
        }
        else
        {
            query = query.Where(a => 
                (a.IdAnimal.HasValue && db.Animales.Any(an => an.IdAnimal == a.IdAnimal.Value && ranchosAutorizadosIds.Contains(an.IdRancho))) ||
                (a.IdLote.HasValue && db.Lotes.Any(l => l.IdLote == a.IdLote.Value && ranchosAutorizadosIds.Contains(l.IdRancho)))
            );
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Alimentacion>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToAlimentacionAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Alimentacion>> Create(Alimentacion item, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        if (!await UserHasAccessToAlimentacionAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        if (item.IdAlimentacion == Guid.Empty)
            item.IdAlimentacion = Guid.NewGuid();

        var existing = await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == item.IdAlimentacion, ct);
        if (existing is not null)
            return Ok(existing);

        item.IdAutor = userId.Value;
        item.Alimento = item.Alimento.Trim();
        item.Racion = item.Racion.Trim();
        item.Unidad = item.Unidad.Trim();
        item.Frecuencia = item.Frecuencia.Trim();
        if (item.Inicio == default) item.Inicio = DateTime.UtcNow;
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Alimentaciones.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo registrar la alimentación; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdAlimentacion }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Alimentacion input, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToAlimentacionAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        if (!await UserHasAccessToAlimentacionAsync(userId.Value, input, ct))
        {
            return Forbid();
        }

        item.IdAnimal = input.IdAnimal;
        item.IdLote = input.IdLote;
        item.Alimento = input.Alimento.Trim();
        item.Racion = input.Racion.Trim();
        item.Cantidad = input.Cantidad;
        item.Unidad = input.Unidad.Trim();
        item.Frecuencia = input.Frecuencia.Trim();
        item.Inicio = input.Inicio;
        item.Fin = input.Fin;
        item.CambioDieta = input.CambioDieta;
        item.IdAutor = userId.Value;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

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

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToAlimentacionAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}