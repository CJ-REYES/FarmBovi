using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record UsuarioRequest(
    [Required, StringLength(120)] string Nombre,
    [Required, EmailAddress, StringLength(254)] string Correo,
    [StringLength(200, MinimumLength = 8)] string? Contrasena,
    [Required, StringLength(20)] string Estado,
    Guid? IdUsuario = null);

public sealed record UsuarioResponse(Guid IdUsuario, string Nombre, string Correo, string Estado, DateTime CreadoEn);

[ApiController]
[Route("api/usuarios")]
public sealed class UsuarioController(FarmDbContext db) : ControllerBase
{
    private static readonly PasswordHasher<Usuario> Hasher = new();

    private static UsuarioResponse ToResponse(Usuario user) =>
        new(user.IdUsuario, user.Nombre, user.Correo, user.Estado, user.CreadoEn);

    [HttpGet]
    public async Task<ActionResult<List<UsuarioResponse>>> GetAll(CancellationToken ct) =>
        (await db.Usuarios.AsNoTracking().ToListAsync(ct)).Select(ToResponse).ToList();

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<UsuarioResponse>> Get(Guid id, CancellationToken ct)
    {
        var item = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.IdUsuario == id, ct);
        return item is null ? NotFound() : Ok(ToResponse(item));
    }

    [HttpPost]
    public async Task<ActionResult<UsuarioResponse>> Create(UsuarioRequest input, CancellationToken ct)
    {
        var id = input.IdUsuario is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.IdUsuario == id, ct);
        if (existing is not null)
            return Ok(ToResponse(existing));

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
        var item = await db.Usuarios.FindAsync([id], ct);
        if (item is null) return NotFound();

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
