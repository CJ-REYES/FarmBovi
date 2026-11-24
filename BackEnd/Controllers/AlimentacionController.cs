using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/alimentacion")]
[RanchScope(RanchResource.Alimentacion)]
public sealed class AlimentacionController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<AlimentacionResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<AlimentacionResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var query = db.Alimentaciones.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        if (idRancho is { } targetRanch && targetRanch != Guid.Empty)
        {
            query = query.Where(x =>
                (x.IdAnimal != null && db.Animales.Any(a => a.IdAnimal == x.IdAnimal && a.IdRancho == targetRanch)) ||
                (x.IdAnimal == null && x.IdLote != null && db.Lotes.Any(l => l.IdLote == x.IdLote && l.IdRancho == targetRanch)));
        }
        else
        {
            query = query.Where(x =>
                (x.IdAnimal != null && db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho))) ||
                (x.IdAnimal == null && x.IdLote != null && db.Lotes.Any(l => l.IdLote == x.IdLote && ranchIds.Contains(l.IdRancho))));
        }

        var items = await query.ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(AlimentacionResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AlimentacionResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El registro de alimentación solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(AlimentacionResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(AlimentacionResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<AlimentacionResponseDto>> Create(
        [FromServices] RanchAccessService access,
        AlimentacionCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdAlimentacion ?? Guid.NewGuid();

        var existing = await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesAlimentacion(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un registro de alimentación con el identificador proporcionado y contenido diferente o eliminado.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var inicio = ApiProblemResults.EnsureUtc(dto.Inicio);
        var fin = ApiProblemResults.EnsureUtc(dto.Fin);
        var validationError = await validator.ValidateAlimentacionAsync(dto.IdAnimal, dto.IdLote, dto.Cantidad, inicio, fin, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        var alimentacion = new Alimentacion
        {
            IdAlimentacion = id,
            IdAnimal = dto.IdAnimal,
            IdLote = dto.IdLote,
            Alimento = dto.Alimento.Trim(),
            Racion = dto.Racion.Trim(),
            Cantidad = dto.Cantidad,
            Unidad = dto.Unidad.Trim(),
            Frecuencia = dto.Frecuencia.Trim(),
            Inicio = inicio,
            Fin = fin,
            CambioDieta = dto.CambioDieta?.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        db.Alimentaciones.Add(alimentacion);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            var collision = await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                var collisionRanch = await access.RanchOfAlimentacionAsync(collision.IdAlimentacion, ct);
                if (userId is { } uid && collisionRanch is { } ranchId && ranchId != Guid.Empty &&
                    await access.CanAccessAsync(uid, ranchId, ct))
                {
                    return collision.EliminadoEn is null && MatchesAlimentacion(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un registro de alimentación con el identificador proporcionado y contenido diferente o eliminado.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("No se pudo registrar la alimentación; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = alimentacion.IdAlimentacion }, ToResponseDto(alimentacion));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(
        [FromServices] RanchAccessService access,
        Guid id,
        AlimentacionUpdateDto dto,
        CancellationToken ct)
    {
        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El registro de alimentación solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un registro de alimentación eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un registro de alimentación utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        var currentRanch = await access.RanchOfAlimentacionAsync(id, ct);
        Guid? targetRanch = dto.IdAnimal.HasValue
            ? await access.RanchOfAnimalAsync(dto.IdAnimal.Value, ct)
            : dto.IdLote.HasValue
                ? await access.RanchOfLoteAsync(dto.IdLote.Value, ct)
                : null;
        if (currentRanch is { } curRanch && curRanch != Guid.Empty &&
            targetRanch is { } dstRanch && dstRanch != curRanch)
        {
            return this.ValidationError("No se permite reasignar una alimentación a un animal o lote de otro rancho.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var inicio = ApiProblemResults.EnsureUtc(dto.Inicio);
        var fin = ApiProblemResults.EnsureUtc(dto.Fin);
        var validationError = await validator.ValidateAlimentacionAsync(dto.IdAnimal, dto.IdLote, dto.Cantidad, inicio, fin, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        item.IdAnimal = dto.IdAnimal;
        item.IdLote = dto.IdLote;
        item.Alimento = dto.Alimento.Trim();
        item.Racion = dto.Racion.Trim();
        item.Cantidad = dto.Cantidad;
        item.Unidad = dto.Unidad.Trim();
        item.Frecuencia = dto.Frecuencia.Trim();
        item.Inicio = inicio;
        item.Fin = fin;
        item.CambioDieta = dto.CambioDieta?.Trim();
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("No se pudo actualizar la alimentación; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El registro de alimentación solicitado no existe.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static bool MatchesAlimentacion(Alimentacion existing, AlimentacionCreateDto dto) =>
        existing.IdAnimal == dto.IdAnimal &&
        existing.IdLote == dto.IdLote &&
        ApiProblemResults.SameText(existing.Alimento, dto.Alimento) &&
        ApiProblemResults.SameText(existing.Racion, dto.Racion) &&
        existing.Cantidad == dto.Cantidad &&
        ApiProblemResults.SameText(existing.Unidad, dto.Unidad) &&
        ApiProblemResults.SameText(existing.Frecuencia, dto.Frecuencia) &&
        ApiProblemResults.SameUtcInstant(existing.Inicio, dto.Inicio) &&
        ApiProblemResults.SameUtcInstant(existing.Fin, dto.Fin) &&
        ApiProblemResults.SameText(existing.CambioDieta, dto.CambioDieta);

    internal static AlimentacionResponseDto ToResponseDto(Alimentacion a) => new()
    {
        IdAlimentacion = a.IdAlimentacion,
        IdAnimal = a.IdAnimal,
        IdLote = a.IdLote,
        Alimento = a.Alimento,
        Racion = a.Racion,
        Cantidad = a.Cantidad,
        Unidad = a.Unidad,
        Frecuencia = a.Frecuencia,
        Inicio = a.Inicio,
        Fin = a.Fin,
        CambioDieta = a.CambioDieta,
        IdAutor = a.IdAutor,
        CreadoEn = a.CreadoEn,
        VersionRegistro = a.VersionRegistro,
        EliminadoEn = a.EliminadoEn
    };
}
