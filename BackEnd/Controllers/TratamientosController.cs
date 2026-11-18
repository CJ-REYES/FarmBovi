using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/tratamientos")]
public sealed class TratamientosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
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

    private async Task<bool> UserHasAccessToTratamientoAsync(int userId, Tratamiento item, CancellationToken ct)
    {
        var idRancho = await db.EventosSanitarios
            .Where(e => e.IdEventoSanitario == item.IdEventoSanitario)
            .Join(db.Animales, e => e.IdAnimal, a => a.IdAnimal, (e, a) => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRancho.HasValue) return false;
        return await UserHasAccessToRanchoAsync(userId, idRancho.Value, ct);
    }

    [HttpGet]
    public async Task<ActionResult<List<Tratamiento>>> GetAll([FromQuery] Guid? idRancho, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.Tratamientos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(t => t.EliminadoEn == null);

        // Filtrar tratamientos cuyos eventos sanitarios y animales pertenezcan a los ranchos autorizados
        query = query.Where(t => db.EventosSanitarios
            .Any(e => e.IdEventoSanitario == t.IdEventoSanitario && 
                      db.Animales.Any(a => a.IdAnimal == e.IdAnimal && ranchosAutorizadosIds.Contains(a.IdRancho))));

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid();
            }
            query = query.Where(t => db.EventosSanitarios
                .Any(e => e.IdEventoSanitario == t.IdEventoSanitario && 
                          db.Animales.Any(a => a.IdAnimal == e.IdAnimal && a.IdRancho == idRancho.Value)));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Tratamiento>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(t => t.IdTratamiento == id, ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToTratamientoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Tratamiento>> Create(Tratamiento item, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        // Validar acceso al rancho a través del evento sanitario -> animal
        var idRanchoEvento = await db.EventosSanitarios
            .Where(e => e.IdEventoSanitario == item.IdEventoSanitario)
            .Join(db.Animales, e => e.IdAnimal, a => a.IdAnimal, (e, a) => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRanchoEvento.HasValue || !await UserHasAccessToRanchoAsync(userId.Value, idRanchoEvento.Value, ct))
        {
            return Forbid();
        }

        if (item.IdTratamiento == Guid.Empty)
            item.IdTratamiento = Guid.NewGuid();

        var existing = await db.Tratamientos.AsNoTracking()
            .FirstOrDefaultAsync(t => t.IdTratamiento == item.IdTratamiento, ct);
        if (existing is not null)
            return Ok(existing);

        int authorId = userId.Value;
        item.IdAutor = authorId;

        var validationError = await validator.ValidateTratamientoAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.Tipo = item.Tipo.Trim();
        item.Medicamento = item.Medicamento.Trim();
        if (item.Dosis is not null) item.Dosis = item.Dosis.Trim();
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Tratamientos.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el tratamiento, verifique la referencia del evento sanitario."); 
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdTratamiento }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Tratamiento input, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToTratamientoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        // Validar acceso al nuevo evento sanitario si cambió
        var idRanchoNuevoEvento = await db.EventosSanitarios
            .Where(e => e.IdEventoSanitario == input.IdEventoSanitario)
            .Join(db.Animales, e => e.IdAnimal, a => a.IdAnimal, (e, a) => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRanchoNuevoEvento.HasValue || !await UserHasAccessToRanchoAsync(userId.Value, idRanchoNuevoEvento.Value, ct))
        {
            return Forbid();
        }

        int authorId = userId.Value;

        var validationError = await validator.ValidateTratamientoAsync(input, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdEventoSanitario = input.IdEventoSanitario;
        item.Tipo = input.Tipo.Trim();
        item.Medicamento = input.Medicamento.Trim();
        item.Dosis = input.Dosis?.Trim();
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro de tratamiento."); 
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToTratamientoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        var hasActiveRecordatorios = await db.Recordatorios.AsNoTracking()
            .AnyAsync(r => r.IdTratamiento == id && r.EliminadoEn == null, ct);
        if (hasActiveRecordatorios)
            return Conflict("No se puede eliminar un tratamiento que tiene recordatorios asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}