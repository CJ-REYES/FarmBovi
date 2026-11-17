using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Authorization; // <-- Necesario para [Authorize]
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims; // <-- Necesario para Claims

namespace FarmBovi.Api.Controllers;

[Authorize] // 🔒 Exige un Token JWT válido para todo el controlador
[ApiController]
[Route("api/animales")]
[Route("api/cattle")]
public sealed class AnimalsController(FarmDbContext db) : ControllerBase
{
    // Método auxiliar para extraer el ID del usuario autenticado desde el JWT
    private int ObtenerUsuarioIdActual()
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier) 
                    ?? User.FindFirst("sub") 
                    ?? User.FindFirst("IdUsuario")
                    ?? User.FindFirst("id");

        return claim != null && int.TryParse(claim.Value, out var id) ? id : 0;
    }

    // Método auxiliar para validar si el usuario tiene acceso al rancho
    private async Task<bool> UsuarioTieneAccesoARanchoAsync(int usuarioId, int idRancho, CancellationToken ct)
    {
        return await db.UsuarioRanchos // Asegúrate de que tu DbSet se llame UsuarioRanchos o ajusta el nombre según tu DbContext
            .AnyAsync(ur => ur.IdUsuario == usuarioId && ur.IdRancho == idRancho, ct);
    }

    [HttpGet]
    public async Task<ActionResult<List<Animal>>> GetAll([FromQuery] int? idRancho, CancellationToken ct)
    {
        int userId = ObtenerUsuarioIdActual();
        var query = db.Animales.AsNoTracking();

        // Seguridad multi-tenancy: Obtenemos los ranchos a los que este usuario tiene acceso
        var ranchosPermitidos = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        if (idRancho.HasValue)
        {
            // Si el cliente pide un rancho específico, validamos que tenga acceso a él
            if (!ranchosPermitidos.Contains(idRancho.Value))
            {
                return Forbid(); // 403 No autorizado para este rancho
            }
            query = query.Where(a => a.IdRancho == idRancho.Value);
        }
        else
        {
            // Si no envía rancho, filtramos estrictamente por los ranchos permitidos del usuario
            query = query.Where(a => ranchosPermitidos.Contains(a.IdRancho));
        }

        var animales = await query.ToListAsync(ct);
        return Ok(animales);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Animal>> Get(int id, CancellationToken ct)
    {
        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return NotFound();

        int userId = ObtenerUsuarioIdActual();
        if (!await UsuarioTieneAccesoARanchoAsync(userId, item.IdRancho, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Animal>> Create(Animal item, CancellationToken ct)
    {
        if (item.IdRancho <= 0)
        {
            return BadRequest("El ID del rancho es obligatorio para registrar un animal.");
        }

        int userId = ObtenerUsuarioIdActual();
        if (!await UsuarioTieneAccesoARanchoAsync(userId, item.IdRancho, ct))
        {
            return Forbid(); // El usuario no pertenece a este rancho
        }

        item.IdAnimal = 0; 
        item.FechaCreacion = DateTime.UtcNow; 
        item.VersionRegistro = 1;

        db.Animales.Add(item);
        
        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("El arete ya existe en este rancho o las referencias no son válidas."); 
        }
        
        return CreatedAtAction(nameof(Get), new { id = item.IdAnimal }, item);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, Animal input, CancellationToken ct)
    {
        var item = await db.Animales.FindAsync([id], ct); 
        if (item is null) return NotFound();

        int userId = ObtenerUsuarioIdActual();

        // Validar acceso al rancho actual del animal y al nuevo rancho si se intenta mover
        if (!await UsuarioTieneAccesoARanchoAsync(userId, item.IdRancho, ct))
        {
            return Forbid();
        }
        if (input.IdRancho != item.IdRancho && !await UsuarioTieneAccesoARanchoAsync(userId, input.IdRancho, ct))
        {
            return Forbid();
        }

        item.IdRancho = input.IdRancho; 
        item.IdLote = input.IdLote; 
        item.Arete = input.Arete; 
        item.Raza = input.Raza; 
        item.Sexo = input.Sexo;
        item.FechaNacimiento = input.FechaNacimiento; 
        item.FechaIngreso = input.FechaIngreso; 
        item.Procedencia = input.Procedencia; 
        item.Estado = input.Estado;
        item.FechaSalida = input.FechaSalida; 
        item.Observaciones = input.Observaciones; 
        item.IdAutor = input.IdAutor; 
        item.EliminadoEn = input.EliminadoEn; 
        item.VersionRegistro++;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("El arete ya existe en este rancho o las referencias no son válidas."); 
        }
        
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.Animales.FindAsync([id], ct); 
        if (item is null) return NotFound(); 

        int userId = ObtenerUsuarioIdActual();
        if (!await UsuarioTieneAccesoARanchoAsync(userId, item.IdRancho, ct))
        {
            return Forbid();
        }

        db.Animales.Remove(item); 
        
        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo eliminar el animal por una restricción de datos."); 
        } 

        return NoContent();
    }
}