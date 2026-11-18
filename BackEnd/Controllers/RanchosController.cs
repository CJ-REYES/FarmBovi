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
[Route("api/ranchos")]
public sealed class RanchosController(FarmDbContext db) : ControllerBase
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
    public async Task<ActionResult<List<Rancho>>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.Ranchos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        query = query.Where(r => ranchosAutorizadosIds.Contains(r.IdRancho));

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Rancho>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        if (!await UserHasAccessToRanchoAsync(userId.Value, id, ct))
        {
            return Forbid();
        }

        var item = await db.Ranchos.AsNoTracking().FirstOrDefaultAsync(r => r.IdRancho == id, ct);
        if (item is null) return NotFound();

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Rancho>> Create(Rancho item, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        if (string.IsNullOrWhiteSpace(item.Nombre) ||
            string.IsNullOrWhiteSpace(item.UbicacionGeneral) ||
            string.IsNullOrWhiteSpace(item.Estado))
        {
            return BadRequest("Nombre, ubicación general y estado del rancho son obligatorios.");
        }

        item.Nombre = item.Nombre.Trim();
        item.UbicacionGeneral = item.UbicacionGeneral.Trim();
        item.Estado = item.Estado.Trim();

        // 1. Validar preventivamente si ya existe un rancho activo con el mismo nombre
        var nombreExiste = await db.Ranchos
            .AnyAsync(r => r.Nombre == item.Nombre && r.EliminadoEn == null, ct);
        
        if (nombreExiste)
        {
            return Conflict($"Ya existe un rancho activo con el nombre '{item.Nombre}'.");
        }

        // 2. Manejo de ID y autor
        if (item.IdRancho == Guid.Empty)
        {
            item.IdRancho = Guid.NewGuid();
        }
        else
        {
            // Si el cliente mandó un ID, verificamos que no exista físicamente para evitar colisión de PK
            var idExistente = await db.Ranchos.AnyAsync(r => r.IdRancho == item.IdRancho, ct);
            if (idExistente)
            {
                item.IdRancho = Guid.NewGuid(); // Forzamos un nuevo ID si ya está ocupado
            }
        }

        item.IdAutor = userId.Value;
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        // Limpiamos propiedades de navegación para evitar inserciones en cascada accidentales
        item.EliminadoEn = null;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            db.Ranchos.Add(item);

            // Validar relación en UsuarioRanchos de forma segura dentro de la transacción
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
                    Estado = "Activo"
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
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        if (!await UserHasAccessToRanchoAsync(userId.Value, id, ct))
        {
            return Forbid();
        }

        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.Nombre = input.Nombre.Trim();
        item.UbicacionGeneral = input.UbicacionGeneral.Trim();
        item.Estado = input.Estado.Trim();
        item.IdAutor = userId.Value;
        item.EliminadoEn = input.EliminadoEn;
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
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        if (!await UserHasAccessToRanchoAsync(userId.Value, id, ct))
        {
            return Forbid();
        }

        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var hasDependencies =
            await db.Lotes.AsNoTracking().AnyAsync(l => l.IdRancho == id && l.EliminadoEn == null, ct) ||
            await db.Animales.AsNoTracking().AnyAsync(a => a.IdRancho == id && a.EliminadoEn == null, ct) ||
            await db.UsuarioRanchos.AsNoTracking().AnyAsync(ur => ur.IdRancho == id, ct); // <-- Eliminado el && ur.EliminadoEn == null

        if (hasDependencies)
            return Conflict("No se puede eliminar un rancho que tiene lotes, animales o usuarios asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
    }