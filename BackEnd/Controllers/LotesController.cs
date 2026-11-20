using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.Lote)]
[Route("api/lotes")]
public sealed class LotesController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<LoteResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<LoteResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Lotes.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(l => l.EliminadoEn == null);

        // Solo registros de ranchos donde el usuario tiene membresía activa.
        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => ranchIds.Contains(x.IdRancho));

        var items = await query.Select(l => ToResponseDto(l)).ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(LoteResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<LoteResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : NotFound();

    [HttpPost]
    [ProducesResponseType(typeof(LoteResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(LoteResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<LoteResponseDto>> Create(LoteCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdLote is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == id, ct);
        if (existing is not null)
            return Ok(ToResponseDto(existing));

        if (dto.IdRancho == Guid.Empty || string.IsNullOrWhiteSpace(dto.Nombre) || string.IsNullOrWhiteSpace(dto.Estado))
            return BadRequest("IdRancho, nombre y estado del lote son obligatorios.");

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var ranchoExists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == dto.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists) return BadRequest("El rancho especificado no existe o está eliminado.");

        var item = new Lote
        {
            IdLote = id,
            IdRancho = dto.IdRancho,
            Nombre = dto.Nombre.Trim(),
            Ubicacion = dto.Ubicacion,
            Estado = dto.Estado.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        db.Lotes.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdLote }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, LoteUpdateDto dto, CancellationToken ct)
    {
        var item = await db.Lotes.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return BadRequest(authorError);

        item.IdRancho = dto.IdRancho;
        item.Nombre = dto.Nombre.Trim();
        item.Ubicacion = dto.Ubicacion;
        item.Estado = dto.Estado.Trim();
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Lotes.FindAsync([id], ct);
        if (item is null) return NotFound();

        var hasActiveAnimals = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdLote == id && a.EliminadoEn == null, ct);
        if (hasActiveAnimals)
            return Conflict("No se puede eliminar un lote que tiene animales activos asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static LoteResponseDto ToResponseDto(Lote l) => new()
    {
        IdLote = l.IdLote,
        IdRancho = l.IdRancho,
        Nombre = l.Nombre,
        Ubicacion = l.Ubicacion,
        Estado = l.Estado,
        IdAutor = l.IdAutor,
        CreadoEn = l.CreadoEn,
        VersionRegistro = l.VersionRegistro
    };
}
