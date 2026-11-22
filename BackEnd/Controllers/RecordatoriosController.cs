using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/recordatorios")]
public sealed class RecordatoriosController(
    FarmDbContext db,
    FarmDomainValidationService validator,
    RanchAccessService access) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<Recordatorio>>> GetAll(
        [FromQuery] Guid? idRancho,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.Recordatorios.AsNoTracking()
            .Where(r => ranchosAutorizadosIds.Contains(r.IdRancho));

        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(r => r.IdRancho == idRancho.Value);
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Recordatorio>> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Recordatorios.AsNoTracking().FirstOrDefaultAsync(r => r.IdRecordatorio == id, ct);
        if (item is null) return NotFound();

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Recordatorio>> Create(Recordatorio item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        if (item.IdRancho == Guid.Empty)
            return BadRequest("El campo idRancho es obligatorio.");

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        if (item.IdRecordatorio == Guid.Empty)
            item.IdRecordatorio = Guid.NewGuid();

        var existing = await db.Recordatorios.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRecordatorio == item.IdRecordatorio, ct);
        if (existing is not null)
            return Ok(existing);

        int authorId = userId.Value;
        item.IdAutor = authorId;

        var validationError = await validator.ValidateRecordatorioAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.Tipo = item.Tipo.Trim();
        item.Descripcion = item.Descripcion.Trim();
        item.Estado = item.Estado.Trim();
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;
        if (item.FechaProgramada == default) item.FechaProgramada = DateTime.UtcNow;
        if (string.Equals(item.Estado, "Completado", StringComparison.OrdinalIgnoreCase) && item.FechaCompletado is null)
            item.FechaCompletado = DateTime.UtcNow;

        db.Recordatorios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el recordatorio; verifica que el rancho y las referencias existan.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdRecordatorio }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Recordatorio input, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Recordatorios.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        if (input.IdRancho != Guid.Empty && input.IdRancho != item.IdRancho)
            return BadRequest("No se puede reasignar el recordatorio a otro rancho.");

        input.IdRancho = item.IdRancho;

        int authorId = userId.Value;

        var validationError = await validator.ValidateRecordatorioAsync(input, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdRancho = input.IdRancho;
        item.IdAnimal = input.IdAnimal;
        item.IdLote = input.IdLote;
        item.IdTratamiento = input.IdTratamiento;
        item.IdResponsable = input.IdResponsable;
        item.Tipo = input.Tipo.Trim();
        item.Descripcion = input.Descripcion.Trim();
        item.FechaProgramada = input.FechaProgramada;
        item.Estado = input.Estado.Trim();
        item.FechaCompletado = string.Equals(item.Estado, "Completado", StringComparison.OrdinalIgnoreCase)
            ? (input.FechaCompletado ?? item.FechaCompletado ?? DateTime.UtcNow)
            : input.FechaCompletado;
        item.IdAutor = authorId;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar el recordatorio; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Recordatorios.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}
