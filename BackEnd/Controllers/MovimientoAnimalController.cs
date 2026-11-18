using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/movimientos-animales")]
public sealed class MovimientoAnimalController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
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

    private async Task<bool> UserHasAccessToMovimientoAsync(int userId, MovimientoAnimal item, CancellationToken ct)
    {
        var idRancho = await db.Animales
            .Where(a => a.IdAnimal == item.IdAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRancho.HasValue) return false;
        return await UserHasAccessToRanchoAsync(userId, idRancho.Value, ct);
    }

    [HttpGet]
    public async Task<ActionResult<List<MovimientoAnimal>>> GetAll([FromQuery] Guid? idRancho, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.MovimientosAnimales.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null);

        // Filtrar movimientos cuyos animales pertenezcan a los ranchos autorizados
        query = query.Where(m => db.Animales.Any(a => a.IdAnimal == m.IdAnimal && ranchosAutorizadosIds.Contains(a.IdRancho)));

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid();
            }
            query = query.Where(m => db.Animales.Any(a => a.IdAnimal == m.IdAnimal && a.IdRancho == idRancho.Value));
        }

        var lista = await query.OrderBy(m => m.Fecha).ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<MovimientoAnimal>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToMovimientoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<MovimientoAnimal>> Create(MovimientoAnimalCreateDto dto, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        // Validar acceso al rancho del animal asociado al movimiento
        var idRanchoAnimal = await db.Animales
            .Where(a => a.IdAnimal == dto.IdAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRanchoAnimal.HasValue || !await UserHasAccessToRanchoAsync(userId.Value, idRanchoAnimal.Value, ct))
        {
            return Forbid();
        }

        var id = dto.IdMovimiento is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (existing is not null)
            return Ok(existing);

        int authorId = userId.Value;

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var movimiento = new MovimientoAnimal
        {
            IdMovimiento = id,
            IdAnimal = dto.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo.Trim(),
            Fecha = dto.Fecha == default ? DateTime.UtcNow : dto.Fecha,
            OrigenExterno = dto.OrigenExterno,
            DestinoExterno = dto.DestinoExterno,
            Motivo = dto.Motivo,
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var (animal, validationError) = await validator.ValidateAndPrepareMovimientoAsync(movimiento, ct);
        if (validationError is not null || animal is null)
            return BadRequest(validationError);

        var tipoNorm = movimiento.Tipo;
        if (movimiento.IdLoteDestino.HasValue &&
            (tipoNorm.Equals("Alta", StringComparison.OrdinalIgnoreCase) ||
             tipoNorm.Equals("CambioInterno", StringComparison.OrdinalIgnoreCase) ||
             tipoNorm.Equals("Cambio interno", StringComparison.OrdinalIgnoreCase)))
        {
            animal.IdLote = movimiento.IdLoteDestino;
            animal.VersionRegistro++;
        }
        else if (tipoNorm.Equals("Venta", StringComparison.OrdinalIgnoreCase) ||
                 tipoNorm.Equals("Baja", StringComparison.OrdinalIgnoreCase))
        {
            animal.Estado = tipoNorm.Equals("Venta", StringComparison.OrdinalIgnoreCase) ? "Vendido" : "Baja";
            animal.FechaSalida = movimiento.Fecha.Date;
            animal.VersionRegistro++;
        }

        db.MovimientosAnimales.Add(movimiento);

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo registrar el movimiento; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = movimiento.IdMovimiento }, movimiento);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, MovimientoAnimalUpdateDto dto, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToMovimientoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        // Validar acceso al nuevo animal si cambió
        var idRanchoNuevoAnimal = await db.Animales
            .Where(a => a.IdAnimal == dto.IdAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRanchoNuevoAnimal.HasValue || !await UserHasAccessToRanchoAsync(userId.Value, idRanchoNuevoAnimal.Value, ct))
        {
            return Forbid();
        }

        int authorId = userId.Value;

        item.IdAnimal = dto.IdAnimal;
        item.IdLoteOrigen = dto.IdLoteOrigen;
        item.IdLoteDestino = dto.IdLoteDestino;
        item.Tipo = dto.Tipo.Trim();
        item.Fecha = dto.Fecha;
        item.OrigenExterno = dto.OrigenExterno;
        item.DestinoExterno = dto.DestinoExterno;
        item.Motivo = dto.Motivo;
        item.IdAutor = authorId;
        item.EliminadoEn = dto.EliminadoEn;
        item.VersionRegistro++;

        var (_, validationError) = await validator.ValidateAndPrepareMovimientoAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo actualizar el movimiento; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToMovimientoAsync(userId.Value, item, ct))
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