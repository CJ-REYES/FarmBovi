using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/eventos-sanitarios")]
public sealed class EventosSanitariosController(
    FarmDbContext db,
    FarmDomainValidationService validator,
    RanchAccessService access) : ControllerBase
{
    private async Task<(Guid? RanchId, IActionResult? Error)> ResolveAnimalRanchAsync(
        int userId,
        Guid idAnimal,
        CancellationToken ct)
    {
        if (idAnimal == Guid.Empty)
            return (null, BadRequest("El campo idAnimal es obligatorio."));

        var idRancho = await db.Animales.AsNoTracking()
            .Where(a => a.IdAnimal == idAnimal)
            .Select(a => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRancho.HasValue || idRancho.Value == Guid.Empty)
            return (null, BadRequest("El animal indicado no existe."));

        if (!await access.CanAccessAsync(userId, idRancho.Value, ct))
            return (null, Forbid());

        return (idRancho.Value, null);
    }

    [HttpGet]
    public async Task<ActionResult<List<EventoSanitario>>> GetAll(
        [FromQuery] Guid? idRancho,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.EventosSanitarios.AsNoTracking()
            .Where(e => db.Animales.Any(a => a.IdAnimal == e.IdAnimal && ranchosAutorizadosIds.Contains(a.IdRancho)));

        if (!incluirEliminados)
            query = query.Where(e => e.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(e => db.Animales.Any(a => a.IdAnimal == e.IdAnimal && a.IdRancho == idRancho.Value));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (error is not null) return error;

        return Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Create(EventoSanitario item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (_, ranchError) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (ranchError is not null) return ranchError;

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
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (currentRanchId, currentError) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (currentError is not null) return currentError;

        var (newRanchId, newError) = await ResolveAnimalRanchAsync(userId.Value, input.IdAnimal, ct);
        if (newError is not null) return newError;

        if (currentRanchId != newRanchId)
            return BadRequest("No se puede reasignar el evento sanitario a un animal de otro rancho.");

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
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (error is not null) return error;

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
