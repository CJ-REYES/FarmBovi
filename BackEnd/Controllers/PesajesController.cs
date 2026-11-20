using System.Security.Claims;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/pesajes")]
[Route("api/weights")]
public sealed class PesajesController(FarmDbContext db) : ControllerBase
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
    public async Task<ActionResult<List<Pesaje>>> GetAll([FromQuery] Guid? idRancho, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        // Obtener los ranchos autorizados para este usuario (int a int)
        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.Pesajes
            .AsNoTracking()
            .Where(p => p.EliminadoEn == null);

        // Restringir a los animales que pertenecen a los ranchos autorizados del usuario
        query = query.Where(p => db.Animales.Any(an => an.IdAnimal == p.IdAnimal && ranchosAutorizadosIds.Contains(an.IdRancho)));

        // Si el usuario especifica un idRancho por query, filtramos adicionalmente (validando que esté en sus autorizados)
        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid(); // No tiene acceso a este rancho
            }
            query = query.Where(p => db.Animales.Any(an => an.IdAnimal == p.IdAnimal && an.IdRancho == idRancho.Value));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Pesaje>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Pesajes.AsNoTracking().FirstOrDefaultAsync(p => p.IdPesaje == id && p.EliminadoEn == null, ct);
        if (item is null) return NotFound();

        // Verificar que el animal del pesaje pertenezca a un rancho autorizado del usuario
        var animal = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == item.IdAnimal, ct);
        if (animal == null || !await UserHasAccessToRanchoAsync(userId.Value, animal.IdRancho, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Pesaje>> Create(Pesaje item, CancellationToken ct)
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
            return Forbid(); // Intento de registrar pesaje en un rancho ajeno
        }

        if (item.IdPesaje == Guid.Empty)
            item.IdPesaje = Guid.NewGuid();

        if (item.IdAutor == 0)
        {
            item.IdAutor = userId.Value;
        }

        db.Pesajes.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el pesaje, verifique la referencia del animal."); 
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdPesaje }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Pesaje input, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Pesajes.FirstOrDefaultAsync(p => p.IdPesaje == id, ct);
        if (item is null) return NotFound();

        // Validar acceso al rancho del registro actual
        var animalActual = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == item.IdAnimal, ct);
        if (animalActual == null || !await UserHasAccessToRanchoAsync(userId.Value, animalActual.IdRancho, ct))
        {
            return Forbid();
        }

        // Si está cambiando de animal, validar también que tenga acceso al nuevo rancho destino
        if (input.IdAnimal != item.IdAnimal)
        {
            var animalNuevo = await db.Animales.AsNoTracking().FirstOrDefaultAsync(an => an.IdAnimal == input.IdAnimal, ct);
            if (animalNuevo == null || !await UserHasAccessToRanchoAsync(userId.Value, animalNuevo.IdRancho, ct))
            {
                return Forbid();
            }
        }

        item.IdAnimal = input.IdAnimal;
        item.Peso = input.Peso;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro de pesaje."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Pesajes.FirstOrDefaultAsync(p => p.IdPesaje == id, ct);
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
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}