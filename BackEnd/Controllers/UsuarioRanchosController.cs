using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/usuario-ranchos")]
public sealed class UsuarioRanchosController(FarmDbContext db, RanchAccessService access) : ControllerBase
{
    private static readonly HashSet<string> AllowedRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "Administrador",
        "Operador",
        "Consulta"
    };

    private static bool IsAdminRole(string? rol) =>
        !string.IsNullOrWhiteSpace(rol) &&
        RanchAccessService.AdminRoles.Contains(rol.Trim().ToLowerInvariant());

    private static string NormalizeRole(string? rol)
    {
        if (string.IsNullOrWhiteSpace(rol)) return "Operador";
        var trimmed = rol.Trim();
        return trimmed.ToLowerInvariant() switch
        {
            "admin" or "administrador" or "propietario" => "Administrador",
            "operador" => "Operador",
            "consulta" => "Consulta",
            _ => trimmed
        };
    }

    [HttpGet]
    public async Task<ActionResult<List<UsuarioRancho>>> GetAll([FromQuery] Guid? idRancho, CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.UsuarioRanchos.AsNoTracking()
            .Where(ur => ranchosAutorizadosIds.Contains(ur.IdRancho));

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(ur => ur.IdRancho == idRancho.Value);
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<UsuarioRancho>> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.UsuarioRanchos.AsNoTracking().FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct);
        if (item is null) return NotFound();

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<UsuarioRancho>> Create(UsuarioRancho item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        if (item.IdRancho == Guid.Empty || item.IdUsuario <= 0)
            return BadRequest("IdRancho e IdUsuario son obligatorios.");

        if (!await access.IsAdminAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        var normalizedRole = NormalizeRole(item.Rol);
        if (!AllowedRoles.Contains(normalizedRole))
            return BadRequest("Rol de membresía no válido.");

        var targetUserExists = await db.Usuarios.AsNoTracking()
            .AnyAsync(u => u.Id == item.IdUsuario, ct);
        if (!targetUserExists)
            return BadRequest("El usuario asignado no existe.");

        var ranchExists = await db.Ranchos.AsNoTracking()
            .AnyAsync(r => r.IdRancho == item.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchExists)
            return NotFound("El rancho no existe o está eliminado.");

        var existing = await db.UsuarioRanchos
            .FirstOrDefaultAsync(ur => ur.IdUsuario == item.IdUsuario && ur.IdRancho == item.IdRancho, ct);

        if (existing is not null)
        {
            if (existing.FechaBaja is null && string.Equals(existing.Estado, "Activo", StringComparison.OrdinalIgnoreCase))
                return Ok(existing);

            existing.Rol = normalizedRole;
            existing.Estado = "Activo";
            existing.FechaBaja = null;
            if (existing.FechaAlta == default) existing.FechaAlta = DateTime.UtcNow;

            await db.SaveChangesAsync(ct);
            return Ok(existing);
        }

        if (item.IdUsuarioRancho == Guid.Empty)
            item.IdUsuarioRancho = Guid.NewGuid();

        item.Rol = normalizedRole;
        item.Estado = string.IsNullOrWhiteSpace(item.Estado) ? "Activo" : item.Estado.Trim();
        item.FechaBaja = null;
        if (item.FechaAlta == default) item.FechaAlta = DateTime.UtcNow;

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

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, UsuarioRancho input, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.UsuarioRanchos.FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct);
        if (item is null) return NotFound();

        if (!await access.IsAdminAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        if (input.IdRancho != Guid.Empty && input.IdRancho != item.IdRancho)
            return BadRequest("No se puede cambiar el rancho de una membresía.");

        if (input.IdUsuario > 0 && input.IdUsuario != item.IdUsuario)
            return BadRequest("No se puede cambiar el usuario de una membresía.");

        var newRole = NormalizeRole(string.IsNullOrWhiteSpace(input.Rol) ? item.Rol : input.Rol);
        if (!AllowedRoles.Contains(newRole))
            return BadRequest("Rol de membresía no válido.");

        var newEstado = string.IsNullOrWhiteSpace(input.Estado) ? item.Estado : input.Estado.Trim();
        var willDeactivate = input.FechaBaja is not null ||
                             !string.Equals(newEstado, "Activo", StringComparison.OrdinalIgnoreCase);

        var currentlyActiveAdmin = item.FechaBaja is null &&
                                   string.Equals(item.Estado, "Activo", StringComparison.OrdinalIgnoreCase) &&
                                   IsAdminRole(item.Rol);

        var staysActiveAdmin = !willDeactivate && IsAdminRole(newRole);

        if (currentlyActiveAdmin && !staysActiveAdmin)
        {
            var otherActiveAdmins = await db.UsuarioRanchos.AsNoTracking()
                .CountAsync(ur => ur.IdRancho == item.IdRancho
                                && ur.IdUsuarioRancho != item.IdUsuarioRancho
                                && ur.FechaBaja == null
                                && ur.Estado.ToLower() == "activo"
                                && RanchAccessService.AdminRoles.Contains(ur.Rol.ToLower()), ct);

            if (otherActiveAdmins == 0)
                return Conflict("No se puede quitar el rol de administrador ni desactivar al último administrador activo del rancho.");
        }

        item.Rol = newRole;
        item.Estado = willDeactivate ? "Inactivo" : "Activo";
        item.FechaBaja = willDeactivate ? (input.FechaBaja ?? DateTime.UtcNow) : null;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar la membresía.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.UsuarioRanchos.FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct);
        if (item is null) return NotFound();

        if (!await access.IsAdminAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        var isActiveAdmin = item.FechaBaja is null &&
                            string.Equals(item.Estado, "Activo", StringComparison.OrdinalIgnoreCase) &&
                            IsAdminRole(item.Rol);

        if (isActiveAdmin)
        {
            var otherActiveAdmins = await db.UsuarioRanchos.AsNoTracking()
                .CountAsync(ur => ur.IdRancho == item.IdRancho
                                && ur.IdUsuarioRancho != item.IdUsuarioRancho
                                && ur.FechaBaja == null
                                && ur.Estado.ToLower() == "activo"
                                && RanchAccessService.AdminRoles.Contains(ur.Rol.ToLower()), ct);

            if (otherActiveAdmins == 0)
                return Conflict("No se puede eliminar al último administrador activo del rancho.");
        }

        db.UsuarioRanchos.Remove(item);
        await db.SaveChangesAsync(ct);

        return NoContent();
    }
}
