using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/reproduccion")]
[Route("api/reproduction")]
public sealed class ReproduccionController(FarmDbContext db, RanchAccessService access) : ControllerBase
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
            return (null, BadRequest("El animal especificado no existe."));

        if (!await access.CanAccessAsync(userId, idRancho.Value, ct))
            return (null, Forbid());

        return (idRancho.Value, null);
    }

    [HttpGet]
    public async Task<ActionResult<List<Reproduccion>>> GetAll([FromQuery] Guid? idRancho, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.Reproduccion
            .AsNoTracking()
            .Where(r => r.EliminadoEn == null &&
                        db.Animales.Any(an => an.IdAnimal == r.IdAnimal && ranchosAutorizadosIds.Contains(an.IdRancho)));

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(r => db.Animales.Any(an => an.IdAnimal == r.IdAnimal && an.IdRancho == idRancho.Value));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Reproduccion.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdReproduccion == id && r.EliminadoEn == null, ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (error is not null) return error;

        return Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Reproduccion item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (_, ranchError) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (ranchError is not null) return ranchError;

        if (item.IdReproduccion == Guid.Empty)
            item.IdReproduccion = Guid.NewGuid();

        var existing = await db.Reproduccion.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdReproduccion == item.IdReproduccion, ct);
        if (existing is not null)
            return Ok(existing);

        if (item.FechaCreacion == default)
            item.FechaCreacion = DateTime.UtcNow;

        if (item.VersionRegistro <= 0)
            item.VersionRegistro = 1;

        item.IdAutor = userId.Value;

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
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Reproduccion.FirstOrDefaultAsync(r => r.IdReproduccion == id, ct);
        if (item is null) return NotFound();

        var (currentRanchId, currentError) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
        if (currentError is not null) return currentError;

        var (newRanchId, newError) = await ResolveAnimalRanchAsync(userId.Value, input.IdAnimal, ct);
        if (newError is not null) return newError;

        if (currentRanchId != newRanchId)
            return BadRequest("No se puede reasignar el registro reproductivo a un animal de otro rancho.");

        item.IdAnimal = input.IdAnimal;
        item.TipoEvento = input.TipoEvento;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = userId.Value;
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
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Reproduccion.FirstOrDefaultAsync(r => r.IdReproduccion == id, ct);
        if (item is null) return NotFound();

        var (_, error) = await ResolveAnimalRanchAsync(userId.Value, item.IdAnimal, ct);
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
