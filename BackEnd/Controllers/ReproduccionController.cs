using System.Security.Claims;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/reproduccion")]
[Route("api/reproduction")]
public sealed class ReproduccionController(FarmDbContext db) : ControllerBase
{
    private int? GetCurrentUserId()
    {
        var rawClaim = User.FindFirstValue(ClaimTypes.NameIdentifier)
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
    public async Task<ActionResult<List<Reproduccion>>> GetAll([FromQuery] Guid? idRancho, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        // Obtener los ranchos autorizados para este usuario (int a int)
        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.Reproduccion
            .AsNoTracking()
            .Where(r => r.EliminadoEn == null);

        // Restringir a los animales que pertenecen a los ranchos autorizados del usuario
        query = query.Where(r => db.Animales.Any(an => an.IdAnimal == r.IdAnimal && ranchosAutorizadosIds.Contains(an.IdRancho)));

        // Si el usuario especifica un idRancho por query, filtramos adicionalmente (validando acceso)
        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid(); // No tiene acceso a este rancho
            }
            query = query.Where(r => db.Animales.Any(an => an.IdAnimal == r.IdAnimal && an.IdRancho == idRancho.Value));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Reproduccion>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Reproduccion.AsNoTracking().FirstOrDefaultAsync(r => r.IdReproduccion == id && r.EliminadoEn == null, ct);
        if (item is null) return NotFound();

        // Verificar que el animal del evento reproductivo pertenezca a un rancho autorizado
        var animal = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == item.IdAnimal, ct);
        if (animal == null || !await UserHasAccessToRanchoAsync(userId.Value, animal.IdRancho, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Reproduccion>> Create(Reproduccion item, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        // Validar que el animal exista y pertenezca a un rancho autorizado del usuario
        var animal = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == item.IdAnimal, ct);
        if (animal == null)
        {
            return BadRequest("El animal especificado no existe.");
        }

        if (!await UserHasAccessToRanchoAsync(userId.Value, animal.IdRancho, ct))
        {
            return Forbid(); // Intento de registrar en un rancho ajeno
        }

        if (item.IdReproduccion == Guid.Empty)
            item.IdReproduccion = Guid.NewGuid();

        if (item.FechaCreacion == default)
            item.FechaCreacion = DateTime.UtcNow;

        if (item.IdAutor == 0)
        {
            item.IdAutor = userId.Value;
        }

        db.Reproduccion.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el evento reproductivo, verifique las referencias del animal."); 
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdReproduccion }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Reproduccion input, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Reproduccion.FirstOrDefaultAsync(r => r.IdReproduccion == id, ct);
        if (item is null) return NotFound();

        // Validar acceso al rancho del registro actual
        var animalActual = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == item.IdAnimal, ct);
        if (animalActual == null || !await UserHasAccessToRanchoAsync(userId.Value, animalActual.IdRancho, ct))
        {
            return Forbid();
        }

        // Si cambia de animal, validar acceso al nuevo rancho destino
        if (input.IdAnimal != item.IdAnimal)
        {
            var animalNuevo = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == input.IdAnimal, ct);
            if (animalNuevo == null || !await UserHasAccessToRanchoAsync(userId.Value, animalNuevo.IdRancho, ct))
            {
                return Forbid();
            }
        }

        item.IdAnimal = input.IdAnimal;
        item.TipoEvento = input.TipoEvento;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;
        item.VersionRegistro++;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro reproductivo."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Reproduccion.FirstOrDefaultAsync(r => r.IdReproduccion == id, ct);
        if (item is null) return NotFound();

        // Validar acceso al rancho del animal asociado
        var animal = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == item.IdAnimal, ct);
        if (animal == null || !await UserHasAccessToRanchoAsync(userId.Value, animal.IdRancho, ct))
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