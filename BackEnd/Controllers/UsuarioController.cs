using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record UsuarioRequest(
    [Required, StringLength(120)] string Nombre,
    [Required, EmailAddress, StringLength(254)] string Correo,
    [StringLength(200, MinimumLength = 8)] string? Contrasena,
    [Required, StringLength(20)] string Estado,
    Guid? IdUsuario = null,
    [StringLength(200)] string? ContrasenaActual = null);

public sealed record UsuarioResponse(Guid IdUsuario, string Nombre, string Correo, string Estado, DateTime CreadoEn);

/// <summary>
/// Reglas de permisos:
/// <list type="bullet">
/// <item>Cualquier usuario autenticado puede consultar y actualizar su propio perfil (sin cambiar su estado);
/// para cambiar su contraseña debe enviar <c>contrasenaActual</c>.</item>
/// <item>Un administrador (rol Admin/Administrador/Propietario) puede consultar a los usuarios de sus ranchos.</item>
/// <item>Crear usuarios requiere ser administrador de al menos un rancho.</item>
/// <item>Modificar, restablecer contraseña o eliminar a otro usuario requiere ser administrador de todos
/// los ranchos a los que pertenece ese usuario. Nadie puede eliminarse a sí mismo.</item>
/// </list>
/// </summary>
[ApiController]
[Route("api/usuarios")]
[Authorize]
public sealed class UsuarioController(FarmDbContext db, RanchAccessService access) : ControllerBase
{
    private static readonly PasswordHasher<Usuario> Hasher = new();

    private static UsuarioResponse ToResponse(Usuario user) =>
        new(user.IdUsuario, user.Nombre, user.Correo, user.Estado, user.CreadoEn);

    private ObjectResult Forbidden(string mensaje) =>
        new(new { mensaje }) { StatusCode = StatusCodes.Status403Forbidden };

    [HttpGet]
    public async Task<ActionResult<List<UsuarioResponse>>> GetAll(CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var adminRanchIds = access.AdminRanchIds(me);
        var visibleUserIds = db.UsuarioRanchos.AsNoTracking()
            .Where(ur => ur.FechaBaja == null && adminRanchIds.Contains(ur.IdRancho))
            .Select(ur => ur.IdUsuario);
        var users = await db.Usuarios.AsNoTracking()
            .Where(u => u.IdUsuario == me || visibleUserIds.Contains(u.IdUsuario))
            .OrderBy(u => u.Nombre)
            .ToListAsync(ct);
        return users.Select(ToResponse).ToList();
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<UsuarioResponse>> Get(Guid id, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.IdUsuario == id, ct);
        if (item is null) return NotFound();
        if (!await access.CanViewUserAsync(me, id, ct))
            return Forbidden("No tienes permisos para consultar este usuario.");
        return Ok(ToResponse(item));
    }

    [HttpPost]
    public async Task<ActionResult<UsuarioResponse>> Create(UsuarioRequest input, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        if (!await access.IsAdminOfAnyAsync(me, ct))
            return Forbidden("Solo un administrador de rancho puede crear usuarios.");

        var id = input.IdUsuario is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.IdUsuario == id, ct);
        if (existing is not null)
        {
            return await access.CanViewUserAsync(me, id, ct)
                ? Ok(ToResponse(existing))
                : Conflict("El identificador de usuario ya está en uso.");
        }

        if (string.IsNullOrWhiteSpace(input.Contrasena) || input.Contrasena.Length < 8)
            return BadRequest("La contraseña debe tener al menos 8 caracteres.");

        var item = new Usuario
        {
            IdUsuario = id,
            Nombre = input.Nombre.Trim(),
            Correo = input.Correo.Trim().ToLowerInvariant(),
            Estado = input.Estado.Trim(),
            CreadoEn = DateTime.UtcNow
        };
        item.Contrasena = Hasher.HashPassword(item, input.Contrasena);

        db.Usuarios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe un usuario con ese correo.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdUsuario }, ToResponse(item));
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, UsuarioRequest input, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var isSelf = me == id;
        var canManage = !isSelf && await access.CanManageUserAsync(me, id, ct);
        if (!isSelf && !canManage)
            return Forbidden("No tienes permisos para modificar este usuario.");

        if (isSelf && !string.Equals(item.Estado, input.Estado.Trim(), StringComparison.OrdinalIgnoreCase))
            return Forbidden("No puedes cambiar el estado de tu propia cuenta.");

        if (!string.IsNullOrWhiteSpace(input.Contrasena) && isSelf)
        {
            // Cambio de contraseña propio: exige la contraseña vigente.
            if (string.IsNullOrWhiteSpace(input.ContrasenaActual) ||
                Hasher.VerifyHashedPassword(item, item.Contrasena, input.ContrasenaActual) == PasswordVerificationResult.Failed)
                return BadRequest("La contraseña actual no es correcta.");
        }

        item.Nombre = input.Nombre.Trim();
        item.Correo = input.Correo.Trim().ToLowerInvariant();
        item.Estado = input.Estado.Trim();
        if (!string.IsNullOrWhiteSpace(input.Contrasena))
            item.Contrasena = Hasher.HashPassword(item, input.Contrasena);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe un usuario con ese correo.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.FindAsync([id], ct);
        if (item is null) return NotFound();
        if (me == id)
            return Forbidden("No puedes eliminar tu propia cuenta.");
        if (!await access.CanManageUserAsync(me, id, ct))
            return Forbidden("No tienes permisos para eliminar este usuario.");

        db.Usuarios.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se puede eliminar un usuario con asignaciones o registros asociados.");
        }

        return NoContent();
    }
}
