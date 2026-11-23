using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record UsuarioRequest(
    [Required, StringLength(120)] string Nombre,
    [Required, EmailAddress, StringLength(254)] string Correo,
    [StringLength(200, MinimumLength = 8)] string? Contrasena,
    [Required, StringLength(20)] string Estado,
    int? Id = null,
    string? ContrasenaActual = null);

public sealed record UsuarioResponse(
    int Id,
    string Nombre,
    string Correo,
    string Estado,
    DateTime CreadoEn,
    string? FotoPerfilUrl = null,
    UserConfigDto? Configuracion = null);

/// <summary>
/// Reglas de permisos:
/// <list type="bullet">
/// <item>Cualquier usuario autenticado puede consultar y actualizar su propio perfil, contraseña,
/// configuración y fotografía de perfil bajo <c>/api/usuarios/me</c> (sin cambiar su estado).</item>
/// <item>Un administrador (rol Admin/Administrador/Propietario) puede consultar a los usuarios de sus ranchos.</item>
/// <item>Crear usuarios vía <c>POST /api/usuarios</c> requiere ser administrador de al menos un rancho
/// (el registro público se atiende en <c>POST /api/auth/register</c>).</item>
/// <item>Modificar, restablecer contraseña o eliminar a otro usuario requiere ser administrador de todos
/// los ranchos a los que pertenece ese usuario. Nadie puede eliminarse a sí mismo.</item>
/// </list>
/// </summary>
[ApiController]
[Authorize]
[Route("api/usuarios")]
public sealed class UsuarioController(
    FarmDbContext db,
    RanchAccessService access,
    ProfilePhotoStorageService? photoStorage = null) : ControllerBase
{
    private static readonly PasswordHasher<Usuario> Hasher = new();

    private ProfilePhotoStorageService Storage =>
        photoStorage ?? new ProfilePhotoStorageService(AppContext.BaseDirectory);

    private UsuarioResponse ToResponse(Usuario user) =>
        new(
            user.Id,
            user.Nombre,
            user.Correo,
            user.Estado,
            user.CreadoEn,
            ProfilePhotoStorageService.ToPublicUrlStatic(user.FotoPerfilRuta),
            UserConfigDto.ParseOrDefault(user.ConfiguracionJson));

    private ObjectResult Forbidden(string mensaje) =>
        new(new { mensaje }) { StatusCode = StatusCodes.Status403Forbidden };

    [HttpGet("me")]
    public async Task<ActionResult<UsuarioResponse>> GetMe(CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.Id == me, ct);
        if (item is null) return NotFound(new { mensaje = "Usuario no encontrado." });
        return Ok(ToResponse(item));
    }

    [HttpPut("me")]
    public async Task<ActionResult<UsuarioResponse>> UpdateMe(UpdateProfileRequest input, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.FindAsync([me], ct);
        if (item is null) return NotFound(new { mensaje = "Usuario no encontrado." });

        var nombre = input.Nombre.Trim();
        var correo = input.Correo.Trim().ToLowerInvariant();
        if (nombre.Length < 2)
            return BadRequest(new { mensaje = "El nombre completo debe tener al menos 2 caracteres." });

        var duplicateEmail = await db.Usuarios.AsNoTracking()
            .AnyAsync(u => u.Id != me && u.Correo.ToLower() == correo, ct);
        if (duplicateEmail)
            return Conflict(new { mensaje = "Ya existe un usuario con ese correo electrónico." });

        item.Nombre = nombre;
        item.Correo = correo;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict(new { mensaje = "Ya existe un usuario con ese correo electrónico." });
        }

        return Ok(ToResponse(item));
    }

    [HttpPut("me/contrasena")]
    public async Task<IActionResult> ChangeMyPassword(ChangePasswordRequest input, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.FindAsync([me], ct);
        if (item is null) return NotFound(new { mensaje = "Usuario no encontrado." });

        if (string.IsNullOrWhiteSpace(input.ContrasenaActual) ||
            Hasher.VerifyHashedPassword(item, item.Contrasena, input.ContrasenaActual) == PasswordVerificationResult.Failed)
        {
            return BadRequest(new { mensaje = "La contraseña actual no es correcta." });
        }

        if (string.IsNullOrWhiteSpace(input.NuevaContrasena) || input.NuevaContrasena.Length < 8)
            return BadRequest(new { mensaje = "La nueva contraseña debe tener al menos 8 caracteres." });

        if (string.Equals(input.ContrasenaActual, input.NuevaContrasena, StringComparison.Ordinal))
            return BadRequest(new { mensaje = "La nueva contraseña debe ser distinta a la contraseña actual." });

        item.Contrasena = Hasher.HashPassword(item, input.NuevaContrasena);
        await db.SaveChangesAsync(ct);

        return Ok(new { mensaje = "Contraseña actualizada correctamente." });
    }

    [HttpPut("me/configuracion")]
    public async Task<ActionResult<UsuarioResponse>> UpdateMyConfig(UserConfigDto input, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.FindAsync([me], ct);
        if (item is null) return NotFound(new { mensaje = "Usuario no encontrado." });

        var (isValid, error, normalized) = UserConfigDto.ValidateAndNormalize(input);
        if (!isValid)
            return BadRequest(new { mensaje = error });

        if (normalized.RanchoPredeterminadoId is { } preferredRanchId)
        {
            var hasAccess = await access.CanAccessAsync(me, preferredRanchId, ct);
            if (!hasAccess)
                return Forbidden("No tienes acceso al rancho seleccionado como predeterminado.");
        }

        item.ConfiguracionJson = normalized.ToJson();
        await db.SaveChangesAsync(ct);

        return Ok(ToResponse(item));
    }

    [HttpPost("me/foto")]
    [RequestSizeLimit(ProfilePhotoStorageService.MaxPhotoBytes + 1024 * 64)]
    public async Task<ActionResult<UsuarioResponse>> UploadMyPhoto(IFormFile? archivo, CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.FindAsync([me], ct);
        if (item is null) return NotFound(new { mensaje = "Usuario no encontrado." });

        var (ok, relativePath, error) = await Storage.SaveUserProfilePhotoAsync(me, archivo, ct);
        if (!ok || string.IsNullOrWhiteSpace(relativePath))
            return BadRequest(new { mensaje = error ?? "No se pudo guardar la foto de perfil." });

        var previousPath = item.FotoPerfilRuta;
        // Solo se guarda la dirección relativa del archivo en la base de datos.
        item.FotoPerfilRuta = relativePath;
        await db.SaveChangesAsync(ct);

        if (!string.IsNullOrWhiteSpace(previousPath) &&
            !string.Equals(previousPath, relativePath, StringComparison.OrdinalIgnoreCase))
        {
            Storage.DeleteIfExists(previousPath);
        }

        return Ok(ToResponse(item));
    }

    [HttpDelete("me/foto")]
    public async Task<ActionResult<UsuarioResponse>> DeleteMyPhoto(CancellationToken ct)
    {
        if (RanchAccessService.GetUserId(User) is not { } me) return Unauthorized();
        var item = await db.Usuarios.FindAsync([me], ct);
        if (item is null) return NotFound(new { mensaje = "Usuario no encontrado." });

        var previousPath = item.FotoPerfilRuta;
        item.FotoPerfilRuta = null;
        await db.SaveChangesAsync(ct);

        if (!string.IsNullOrWhiteSpace(previousPath))
            Storage.DeleteIfExists(previousPath);

        return Ok(ToResponse(item));
    }

    [HttpGet]
    public async Task<ActionResult<List<UsuarioResponse>>> GetAll(CancellationToken ct)
    {
        var currentUserId = RanchAccessService.GetUserId(User);
        if (currentUserId is null) return Unauthorized();

        var adminRanchIds = await access.AdminRanchIds(currentUserId.Value).Distinct().ToListAsync(ct);
        if (adminRanchIds.Count == 0)
        {
            var self = await db.Usuarios.AsNoTracking()
                .Where(u => u.Id == currentUserId.Value)
                .Select(u => ToResponse(u))
                .ToListAsync(ct);
            return Ok(self);
        }

        var visibleUserIds = await db.UsuarioRanchos.AsNoTracking()
            .Where(ur => ur.FechaBaja == null && adminRanchIds.Contains(ur.IdRancho))
            .Select(ur => ur.IdUsuario)
            .Distinct()
            .ToListAsync(ct);

        var users = await db.Usuarios.AsNoTracking()
            .Where(u => u.Id == currentUserId.Value || visibleUserIds.Contains(u.Id))
            .ToListAsync(ct);

        return Ok(users.Select(ToResponse).ToList());
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<UsuarioResponse>> Get(int id, CancellationToken ct)
    {
        var currentUserId = RanchAccessService.GetUserId(User);
        if (currentUserId is null) return Unauthorized();

        if (!await access.CanViewUserAsync(currentUserId.Value, id, ct))
            return Forbid();

        var item = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
        return item is null ? NotFound() : Ok(ToResponse(item));
    }

    [HttpPost]
    public async Task<ActionResult<UsuarioResponse>> Create(UsuarioRequest input, CancellationToken ct)
    {
        var currentUserId = RanchAccessService.GetUserId(User);
        if (currentUserId is null) return Unauthorized();

        if (!await access.IsAdminOfAnyAsync(currentUserId.Value, ct))
            return Forbid();

        if (string.IsNullOrWhiteSpace(input.Contrasena) || input.Contrasena.Length < 8)
            return BadRequest("La contraseña debe tener al menos 8 caracteres.");

        var item = new Usuario
        {
            Nombre = input.Nombre.Trim(),
            Correo = input.Correo.Trim().ToLowerInvariant(),
            Estado = input.Estado.Trim(),
            ConfiguracionJson = UserConfigDto.Default.ToJson(),
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

        return CreatedAtAction(nameof(Get), new { id = item.Id }, ToResponse(item));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, UsuarioRequest input, CancellationToken ct)
    {
        var currentUserId = RanchAccessService.GetUserId(User);
        if (currentUserId is null) return Unauthorized();

        var isSelf = currentUserId.Value == id;
        var canManage = await access.CanManageUserAsync(currentUserId.Value, id, ct);
        if (!isSelf && !canManage)
            return Forbid();

        var item = await db.Usuarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var requestedEstado = input.Estado.Trim();
        if (!canManage && !string.Equals(requestedEstado, item.Estado, StringComparison.OrdinalIgnoreCase))
            return Forbid();

        if (!string.IsNullOrWhiteSpace(input.Contrasena))
        {
            if (input.Contrasena.Length < 8)
                return BadRequest("La contraseña debe tener al menos 8 caracteres.");

            if (!canManage)
            {
                if (string.IsNullOrWhiteSpace(input.ContrasenaActual))
                    return BadRequest("Debes proporcionar la contraseña actual para cambiarla.");

                var verifyResult = Hasher.VerifyHashedPassword(item, item.Contrasena, input.ContrasenaActual);
                if (verifyResult == PasswordVerificationResult.Failed)
                    return BadRequest("La contraseña actual es incorrecta.");
            }

            item.Contrasena = Hasher.HashPassword(item, input.Contrasena);
        }

        item.Nombre = input.Nombre.Trim();
        item.Correo = input.Correo.Trim().ToLowerInvariant();
        if (canManage)
            item.Estado = requestedEstado;

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

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var currentUserId = RanchAccessService.GetUserId(User);
        if (currentUserId is null) return Unauthorized();

        if (currentUserId.Value == id || !await access.CanManageUserAsync(currentUserId.Value, id, ct))
            return Forbid();

        var item = await db.Usuarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var oldPhoto = item.FotoPerfilRuta;
        db.Usuarios.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se puede eliminar un usuario con asignaciones o registros asociados.");
        }

        if (!string.IsNullOrWhiteSpace(oldPhoto))
            Storage.DeleteIfExists(oldPhoto);

        return NoContent();
    }
}
