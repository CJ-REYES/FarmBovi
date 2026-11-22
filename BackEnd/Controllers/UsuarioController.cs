using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Data;
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

public sealed record UsuarioResponse(int Id, string Nombre, string Correo, string Estado);

[ApiController]
[Authorize]
[Route("api/usuarios")]
public sealed class UsuarioController(FarmDbContext db, RanchAccessService access) : ControllerBase
{
    private static readonly PasswordHasher<Usuario> Hasher = new();

    private static UsuarioResponse ToResponse(Usuario user) =>
        new(user.Id, user.Nombre, user.Correo, user.Estado);

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
            Estado = input.Estado.Trim()
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
