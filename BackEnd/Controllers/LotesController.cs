using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/lotes")]
[RanchScope(RanchResource.Lote)]
public sealed class LotesController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<LoteResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<LoteResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var query = db.Lotes.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(l => l.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => ranchIds.Contains(x.IdRancho));
        if (idRancho is { } targetRanch && targetRanch != Guid.Empty)
            query = query.Where(x => x.IdRancho == targetRanch);

        var items = await query.ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(LoteResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<LoteResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El lote solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(LoteResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(LoteResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<LoteResponseDto>> Create(
        [FromServices] RanchAccessService access,
        LoteCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdLote ?? Guid.NewGuid();

        var existing = await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesLote(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un lote con el identificador proporcionado y contenido diferente o eliminado.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var ranchoExists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == dto.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists) return this.ValidationError("El rancho especificado no existe o está eliminado.", nameof(dto.IdRancho));

        var item = new Lote
        {
            IdLote = id,
            IdRancho = dto.IdRancho,
            Nombre = dto.Nombre.Trim(),
            Ubicacion = dto.Ubicacion?.Trim(),
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
            var collision = await db.Lotes.AsNoTracking().FirstOrDefaultAsync(l => l.IdLote == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                if (userId is { } uid && await access.CanAccessAsync(uid, collision.IdRancho, ct))
                {
                    return collision.EliminadoEn is null && MatchesLote(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un lote con el identificador proporcionado y contenido diferente o eliminado.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
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
        if (item is null) return this.NotFoundProblem("El lote solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un lote eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un lote utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        if (dto.IdRancho != item.IdRancho)
            return this.ValidationError("No se permite transferir un lote a otro rancho mediante actualización directa.", nameof(dto.IdRancho));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var ranchoExists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == dto.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists) return this.ValidationError("El rancho especificado no existe o está eliminado.", nameof(dto.IdRancho));

        item.Nombre = dto.Nombre.Trim();
        item.Ubicacion = dto.Ubicacion?.Trim();
        item.Estado = dto.Estado.Trim();
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("Ya existe el nombre de lote en ese rancho o el rancho no existe.");
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
        if (item is null) return this.NotFoundProblem("El lote solicitado no existe.");

        var hasActiveAnimals = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdLote == id && a.EliminadoEn == null, ct);
        if (hasActiveAnimals)
            return this.ConflictProblem("No se puede eliminar un lote que tiene animales activos asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static bool MatchesLote(Lote existing, LoteCreateDto dto) =>
        existing.IdRancho == dto.IdRancho &&
        ApiProblemResults.SameText(existing.Nombre, dto.Nombre) &&
        ApiProblemResults.SameText(existing.Ubicacion, dto.Ubicacion) &&
        ApiProblemResults.SameText(existing.Estado, dto.Estado);

    internal static LoteResponseDto ToResponseDto(Lote l) => new()
    {
        IdLote = l.IdLote,
        IdRancho = l.IdRancho,
        Nombre = l.Nombre,
        Ubicacion = l.Ubicacion,
        Estado = l.Estado,
        IdAutor = l.IdAutor,
        CreadoEn = l.CreadoEn,
        VersionRegistro = l.VersionRegistro,
        EliminadoEn = l.EliminadoEn
    };
}
