using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/tratamientos")]
public sealed class TratamientosController(
    FarmDbContext db,
    FarmDomainValidationService validator,
    RanchAccessService access) : ControllerBase
{
    private async Task<(Guid? RanchId, IActionResult? Error)> ResolveEventoRanchAsync(
        int userId,
        Guid idEventoSanitario,
        CancellationToken ct)
    {
        if (idEventoSanitario == Guid.Empty)
            return (null, BadRequest("El campo idEventoSanitario es obligatorio."));

        var idRancho = await db.EventosSanitarios.AsNoTracking()
            .Where(e => e.IdEventoSanitario == idEventoSanitario)
            .Join(db.Animales.AsNoTracking(), e => e.IdAnimal, a => a.IdAnimal, (e, a) => (Guid?)a.IdRancho)
            .FirstOrDefaultAsync(ct);

        if (!idRancho.HasValue || idRancho.Value == Guid.Empty)
            return (null, BadRequest("El evento sanitario o su animal asociado no existe."));

        if (!await access.CanAccessAsync(userId, idRancho.Value, ct))
            return (null, Forbid());

        return (idRancho.Value, null);
    }

    [HttpGet]
    public async Task<ActionResult<List<Tratamiento>>> GetAll(
        [FromQuery] Guid? idRancho,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.Tratamientos.AsNoTracking()
            .Where(t => db.EventosSanitarios
                .Any(e => e.IdEventoSanitario == t.IdEventoSanitario &&
                          db.Animales.Any(a => a.IdAnimal == e.IdAnimal && ranchosAutorizadosIds.Contains(a.IdRancho))));

        if (!incluirEliminados)
            query = query.Where(t => t.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(t => db.EventosSanitarios
                .Any(e => e.IdEventoSanitario == t.IdEventoSanitario &&
                          db.Animales.Any(a => a.IdAnimal == e.IdAnimal && a.IdRancho == idRancho.Value)));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(t => t.IdTratamiento == id, ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveEventoRanchAsync(userId.Value, item.IdEventoSanitario, ct);
        if (error is not null) return error;

        return Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Tratamiento item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (_, ranchError) = await ResolveEventoRanchAsync(userId.Value, item.IdEventoSanitario, ct);
        if (ranchError is not null) return ranchError;

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
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
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
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (currentRanchId, currentError) = await ResolveEventoRanchAsync(userId.Value, item.IdEventoSanitario, ct);
        if (currentError is not null) return currentError;

        var (newRanchId, newError) = await ResolveEventoRanchAsync(userId.Value, input.IdEventoSanitario, ct);
        if (newError is not null) return newError;

        if (currentRanchId != newRanchId)
            return BadRequest("No se puede reasignar el tratamiento a un evento sanitario de otro rancho.");

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
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveEventoRanchAsync(userId.Value, item.IdEventoSanitario, ct);
        if (error is not null) return error;

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
