using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record UsuarioRequest([Required, StringLength(120)] string Nombre, [Required, EmailAddress, StringLength(254)] string Correo, [StringLength(200, MinimumLength = 8)] string? Contrasena, [Required, StringLength(30)] string Estado);
public sealed record UsuarioResponse(int Id, string Nombre, string Correo, string Estado);

[ApiController, Route("api/usuarios")]
public sealed class UsuarioController(FarmDbContext db) : ControllerBase
{
    private static readonly PasswordHasher<Usuario> Hasher = new();
    private static UsuarioResponse ToResponse(Usuario user) => new(user.Id, user.Nombre, user.Correo, user.Estado);

    [HttpGet] public async Task<ActionResult<List<UsuarioResponse>>> GetAll(CancellationToken ct) => (await db.Usuarios.AsNoTracking().ToListAsync(ct)).Select(ToResponse).ToList();
    [HttpGet("{id:int}")] public async Task<ActionResult<UsuarioResponse>> Get(int id, CancellationToken ct) { var item=await db.Usuarios.FindAsync([id],ct); return item is null ? NotFound() : Ok(ToResponse(item)); }
    [HttpPost] public async Task<ActionResult<UsuarioResponse>> Create(UsuarioRequest input, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(input.Contrasena) || input.Contrasena.Length < 8) return BadRequest("La contraseña debe tener al menos 8 caracteres.");
        var item = new Usuario { Nombre=input.Nombre.Trim(), Correo=input.Correo.Trim().ToLowerInvariant(), Estado=input.Estado.Trim() };
        item.Contrasena = Hasher.HashPassword(item, input.Contrasena);
        db.Usuarios.Add(item);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("Ya existe un usuario con ese correo."); }
        return CreatedAtAction(nameof(Get), new { id=item.Id }, ToResponse(item));
    }
    [HttpPut("{id:int}")] public async Task<IActionResult> Update(int id, UsuarioRequest input, CancellationToken ct)
    {
        var item=await db.Usuarios.FindAsync([id],ct); if(item is null)return NotFound();
        item.Nombre=input.Nombre.Trim(); item.Correo=input.Correo.Trim().ToLowerInvariant(); item.Estado=input.Estado.Trim();
        if (!string.IsNullOrWhiteSpace(input.Contrasena)) item.Contrasena=Hasher.HashPassword(item,input.Contrasena);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("Ya existe un usuario con ese correo."); }
        return NoContent();
    }
    [HttpDelete("{id:int}")] public async Task<IActionResult> Delete(int id, CancellationToken ct) { var item=await db.Usuarios.FindAsync([id],ct); if(item is null)return NotFound(); db.Usuarios.Remove(item); try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("No se puede eliminar un usuario con asignaciones a ranchos."); } return NoContent(); }
}
