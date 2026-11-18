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
[Route("api/eventos-sanitarios")]
public sealed class EventosSanitariosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
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

    private async Task<bool> UserHasAccessToEventoAsync(int userId, EventoSanitario item, CancellationToken ct)
    {
        var idRancho = await db.Animales
            .Where(a => a.IdAnimal == item.IdAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRancho.HasValue) return false;
        return await UserHasAccessToRanchoAsync(userId, idRancho.Value, ct);
    }

    [HttpGet]
    public async Task<ActionResult<List<EventoSanitario>>> GetAll([FromQuery] Guid? idRancho, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var ranchosAutorizadosIds = await db.UsuarioRanchos
            .Where(ur => ur.IdUsuario == userId.Value)
            .Select(ur => ur.IdRancho)
            .ToListAsync(ct);

        var query = db.EventosSanitarios.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(e => e.EliminadoEn == null);

        // Filtrar eventos sanitarios cuyos animales pertenezcan a los ranchos autorizados
        query = query.Where(e => db.Animales.Any(a => a.IdAnimal == e.IdAnimal && ranchosAutorizadosIds.Contains(a.IdRancho)));

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
            {
                return Forbid();
            }
            query = query.Where(e => db.Animales.Any(a => a.IdAnimal == e.IdAnimal && a.IdRancho == idRancho.Value));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<EventoSanitario>> Get(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToEventoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<EventoSanitario>> Create(EventoSanitario item, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        // Validar que el animal pertenezca a un rancho autorizado
        var idRanchoAnimal = await db.Animales
            .Where(a => a.IdAnimal == item.IdAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRanchoAnimal.HasValue || !await UserHasAccessToRanchoAsync(userId.Value, idRanchoAnimal.Value, ct))
        {
            return Forbid();
        }

        if (item.IdEventoSanitario == Guid.Empty)
            item.IdEventoSanitario = Guid.NewGuid();

        var existing = await db.EventosSanitarios.AsNoTracking()
            .FirstOrDefaultAsync(e => e.IdEventoSanitario == item.IdEventoSanitario, ct);
        if (existing is not null)
            return Ok(existing);

        int authorId = userId.Value;
        item.IdAutor = authorId;

        var validationError = await validator.ValidateEventoSanitarioAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.Tipo = item.Tipo.Trim();
        item.Responsable = item.Responsable.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;
        if (item.Fecha == default) item.Fecha = DateTime.UtcNow;

        db.EventosSanitarios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el evento sanitario; verifica que el animal exista.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdEventoSanitario }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, EventoSanitario input, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        // Validar acceso al evento actual
        if (!await UserHasAccessToEventoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        // Validar acceso al nuevo animal destino si cambió
        var idRanchoNuevoAnimal = await db.Animales
            .Where(a => a.IdAnimal == input.IdAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRanchoNuevoAnimal.HasValue || !await UserHasAccessToRanchoAsync(userId.Value, idRanchoNuevoAnimal.Value, ct))
        {
            return Forbid();
        }

        int authorId = userId.Value;

        var validationError = await validator.ValidateEventoSanitarioAsync(input, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAnimal = input.IdAnimal;
        item.Tipo = input.Tipo.Trim();
        item.Fecha = input.Fecha;
        item.Sintomas = input.Sintomas;
        item.Diagnostico = input.Diagnostico;
        item.ProfesionalDiagnostico = input.ProfesionalDiagnostico;
        item.EvidenciaDiagnosticoUri = input.EvidenciaDiagnosticoUri;
        item.Responsable = input.Responsable.Trim();
        item.Observaciones = input.Observaciones;
        item.IdAutor = authorId;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar el evento sanitario; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await UserHasAccessToEventoAsync(userId.Value, item, ct))
        {
            return Forbid();
        }

        var hasActiveTratamientos = await db.Tratamientos.AsNoTracking()
            .AnyAsync(t => t.IdEventoSanitario == id && t.EliminadoEn == null, ct);
        if (hasActiveTratamientos)
            return Conflict("No se puede eliminar un evento sanitario que tiene tratamientos asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}