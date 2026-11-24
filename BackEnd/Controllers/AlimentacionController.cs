using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/alimentacion")]
[Route("api/feeding")]
public sealed class AlimentacionController(FarmDbContext db, RanchAccessService access) : ControllerBase
{
    private async Task<(Guid? RanchId, IActionResult? Error)> ResolveAndValidateTargetRanchAsync(
        int userId,
        Guid? idAnimal,
        Guid? idLote,
        CancellationToken ct)
    {
        Guid? animalRanchId = null;
        if (idAnimal.HasValue && idAnimal.Value != Guid.Empty)
        {
            animalRanchId = await db.Animales.AsNoTracking()
                .Where(a => a.IdAnimal == idAnimal.Value)
                .Select(a => (Guid?)a.IdRancho)
                .FirstOrDefaultAsync(ct);

            if (!animalRanchId.HasValue || animalRanchId.Value == Guid.Empty)
                return (null, BadRequest("El animal indicado no existe."));
        }

        Guid? loteRanchId = null;
        if (idLote.HasValue && idLote.Value != Guid.Empty)
        {
            loteRanchId = await db.Lotes.AsNoTracking()
                .Where(l => l.IdLote == idLote.Value)
                .Select(l => (Guid?)l.IdRancho)
                .FirstOrDefaultAsync(ct);

            if (!loteRanchId.HasValue || loteRanchId.Value == Guid.Empty)
                return (null, BadRequest("El lote indicado no existe."));
        }

        if (animalRanchId.HasValue && loteRanchId.HasValue && animalRanchId.Value != loteRanchId.Value)
            return (null, BadRequest("El animal y el lote indicados pertenecen a ranchos distintos."));

        var targetRanchId = animalRanchId ?? loteRanchId;
        if (!targetRanchId.HasValue)
            return (null, BadRequest("Debe indicar un idAnimal o idLote válido."));

        if (!await access.CanAccessAsync(userId, targetRanchId.Value, ct))
            return (null, Forbid());

        return (targetRanchId.Value, null);
    }

    [HttpGet]
    public async Task<ActionResult<List<Alimentacion>>> GetAll(
        [FromQuery] Guid? idRancho,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.Alimentaciones.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(a =>
                (a.IdAnimal.HasValue && db.Animales.Any(an => an.IdAnimal == a.IdAnimal.Value && an.IdRancho == idRancho.Value)) ||
                (a.IdLote.HasValue && db.Lotes.Any(l => l.IdLote == a.IdLote.Value && l.IdRancho == idRancho.Value))
            );
        }
        else
        {
            query = query.Where(a =>
                (a.IdAnimal.HasValue && db.Animales.Any(an => an.IdAnimal == a.IdAnimal.Value && ranchosAutorizadosIds.Contains(an.IdRancho))) ||
                (a.IdLote.HasValue && db.Lotes.Any(l => l.IdLote == a.IdLote.Value && ranchosAutorizadosIds.Contains(l.IdRancho)))
            );
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveAndValidateTargetRanchAsync(userId.Value, item.IdAnimal, item.IdLote, ct);
        if (error is not null) return error;

        return Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Alimentacion item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (_, error) = await ResolveAndValidateTargetRanchAsync(userId.Value, item.IdAnimal, item.IdLote, ct);
        if (error is not null) return error;

        if (item.IdAlimentacion == Guid.Empty)
            item.IdAlimentacion = Guid.NewGuid();

        var existing = await db.Alimentaciones.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAlimentacion == item.IdAlimentacion, ct);
        if (existing is not null)
            return Ok(existing);

        item.IdAutor = userId.Value;
        item.Alimento = item.Alimento.Trim();
        item.Racion = item.Racion.Trim();
        item.Unidad = item.Unidad.Trim();
        item.Frecuencia = item.Frecuencia.Trim();
        if (item.Inicio == default) item.Inicio = DateTime.UtcNow;
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;

        db.Alimentaciones.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo registrar la alimentación; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdAlimentacion }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Alimentacion input, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (_, existingError) = await ResolveAndValidateTargetRanchAsync(userId.Value, item.IdAnimal, item.IdLote, ct);
        if (existingError is not null) return existingError;

        var (_, newError) = await ResolveAndValidateTargetRanchAsync(userId.Value, input.IdAnimal, input.IdLote, ct);
        if (newError is not null) return newError;

        item.IdAnimal = input.IdAnimal;
        item.IdLote = input.IdLote;
        item.Alimento = input.Alimento.Trim();
        item.Racion = input.Racion.Trim();
        item.Cantidad = input.Cantidad;
        item.Unidad = input.Unidad.Trim();
        item.Frecuencia = input.Frecuencia.Trim();
        item.Inicio = input.Inicio;
        item.Fin = input.Fin;
        item.CambioDieta = input.CambioDieta;
        item.IdAutor = userId.Value;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar el registro de alimentación.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveAndValidateTargetRanchAsync(userId.Value, item.IdAnimal, item.IdLote, ct);
        if (error is not null) return error;

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}
