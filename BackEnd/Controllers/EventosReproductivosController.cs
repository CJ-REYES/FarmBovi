using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/eventos-reproductivos")]
[RanchScope(RanchResource.EventoReproductivo)]
public sealed class EventosReproductivosController(
    FarmDbContext db,
    FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<EventoReproductivoResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<EventoReproductivoResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] Guid? idAnimal = null,
        [FromQuery] string? tipo = null,
        [FromQuery] DateTime? desde = null,
        [FromQuery] DateTime? hasta = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User) ?? 0;

        if (idRancho is { } requestedRanchId)
        {
            if (requestedRanchId == Guid.Empty)
                return this.ValidationError("El identificador del rancho (idRancho) no es válido.", nameof(idRancho));

            if (!await access.CanAccessAsync(userId, requestedRanchId, ct))
                return this.ForbiddenProblem("No tienes permisos sobre el rancho solicitado.");
        }

        if (idAnimal is { } targetAnimalId)
        {
            if (targetAnimalId == Guid.Empty)
                return this.ValidationError("El identificador del animal (idAnimal) no es válido.", nameof(idAnimal));

            var animalRanch = await access.RanchOfAnimalAsync(targetAnimalId, ct);
            if (animalRanch is { } ownerRanch && !await access.CanAccessAsync(userId, ownerRanch, ct))
                return this.ForbiddenProblem("No tienes permisos sobre el rancho de este animal.");
        }

        if (desde.HasValue && hasta.HasValue &&
            ApiProblemResults.EnsureUtc(desde.Value) > ApiProblemResults.EnsureUtc(hasta.Value))
        {
            return this.ValidationError("La fecha inicial (desde) no puede ser posterior a la fecha final (hasta).", nameof(desde));
        }

        var query = db.EventosReproductivos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(e => e.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(userId);
        query = idRancho is { } targetRanch && targetRanch != Guid.Empty
            ? query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && a.IdRancho == targetRanch))
            : query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho)));

        if (idAnimal is { } filterAnimal && filterAnimal != Guid.Empty)
            query = query.Where(x => x.IdAnimal == filterAnimal);

        if (!string.IsNullOrWhiteSpace(tipo))
        {
            var normalizedTipo = tipo.Trim().ToLower();
            query = query.Where(x => x.Tipo.ToLower() == normalizedTipo);
        }

        if (desde.HasValue)
        {
            var fromUtc = ApiProblemResults.EnsureUtc(desde.Value);
            query = query.Where(x => x.Fecha >= fromUtc);
        }

        if (hasta.HasValue)
        {
            var toUtc = ApiProblemResults.EnsureUtc(hasta.Value);
            query = query.Where(x => x.Fecha <= toUtc);
        }

        var items = await query
            .OrderByDescending(x => x.Fecha)
            .ThenByDescending(x => x.CreadoEn)
            .ThenBy(x => x.IdEventoReproductivo)
            .ToListAsync(ct);

        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(EventoReproductivoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<EventoReproductivoResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.EventosReproductivos.AsNoTracking()
            .FirstOrDefaultAsync(e => e.IdEventoReproductivo == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El evento reproductivo solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(EventoReproductivoResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(EventoReproductivoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<EventoReproductivoResponseDto>> Create(
        [FromServices] RanchAccessService access,
        EventoReproductivoCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdEventoReproductivo ?? Guid.NewGuid();

        var existing = await db.EventosReproductivos.AsNoTracking()
            .FirstOrDefaultAsync(e => e.IdEventoReproductivo == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesEventoReproductivo(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un evento reproductivo con el identificador proporcionado y contenido diferente o eliminado.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? 0, ct);
        if (authorError is not null)
            return this.ValidationError(authorError, nameof(dto.IdAutor));

        var item = new EventoReproductivo
        {
            IdEventoReproductivo = id,
            IdAnimal = dto.IdAnimal,
            IdSemental = dto.IdSemental,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtc(dto.Fecha),
            Resultado = NormalizeOptional(dto.Resultado),
            Observaciones = NormalizeOptional(dto.Observaciones),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateEventoReproductivoAsync(item, excludeEventId: null, ct);
        if (validationError is not null)
            return this.ValidationError(validationError);

        db.EventosReproductivos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            var collision = await db.EventosReproductivos.AsNoTracking()
                .FirstOrDefaultAsync(e => e.IdEventoReproductivo == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                var collisionRanch = await access.RanchOfAnimalAsync(collision.IdAnimal, ct);
                if (userId is { } uid && collisionRanch is { } ranchId &&
                    await access.CanAccessAsync(uid, ranchId, ct))
                {
                    return collision.EliminadoEn is null && MatchesEventoReproductivo(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un evento reproductivo con el identificador proporcionado y contenido diferente o eliminado.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("No se pudo registrar el evento reproductivo; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdEventoReproductivo }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, EventoReproductivoUpdateDto dto, CancellationToken ct)
    {
        var item = await db.EventosReproductivos.FindAsync([id], ct);
        if (item is null)
            return this.NotFoundProblem("El evento reproductivo solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un evento reproductivo eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un evento reproductivo utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        if (dto.IdAnimal != item.IdAnimal)
            return this.ValidationError("No se permite cambiar el animal asociado a un evento reproductivo.", nameof(dto.IdAnimal));

        if (dto.VersionRegistro.HasValue && dto.VersionRegistro.Value != item.VersionRegistro)
            return this.ConflictProblem("El evento reproductivo fue modificado por otro usuario o dispositivo. Recarga los datos e intenta nuevamente.");

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? 0, ct);
        if (authorError is not null)
            return this.ValidationError(authorError, nameof(dto.IdAutor));

        var candidate = new EventoReproductivo
        {
            IdEventoReproductivo = item.IdEventoReproductivo,
            IdAnimal = dto.IdAnimal,
            IdSemental = dto.IdSemental,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtc(dto.Fecha),
            Resultado = NormalizeOptional(dto.Resultado),
            Observaciones = NormalizeOptional(dto.Observaciones),
            IdAutor = authorId
        };

        var validationError = await validator.ValidateEventoReproductivoAsync(
            candidate,
            excludeEventId: item.IdEventoReproductivo,
            ct);
        if (validationError is not null)
            return this.ValidationError(validationError);

        item.IdSemental = candidate.IdSemental;
        item.Tipo = candidate.Tipo;
        item.Fecha = candidate.Fecha;
        item.Resultado = candidate.Resultado;
        item.Observaciones = candidate.Observaciones;
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return this.ConflictProblem("El evento reproductivo fue modificado concurrentemente. Recarga los datos e intenta nuevamente.");
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("No se pudo actualizar el evento reproductivo; verifica las referencias.");
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
        var item = await db.EventosReproductivos.FindAsync([id], ct);
        if (item is null)
            return this.NotFoundProblem("El evento reproductivo solicitado no existe.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static string? NormalizeOptional(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static bool MatchesEventoReproductivo(EventoReproductivo existing, EventoReproductivoCreateDto dto) =>
        existing.IdAnimal == dto.IdAnimal &&
        existing.IdSemental == dto.IdSemental &&
        ApiProblemResults.SameText(existing.Tipo, dto.Tipo) &&
        ApiProblemResults.SameUtcInstant(existing.Fecha, dto.Fecha) &&
        ApiProblemResults.SameText(existing.Resultado, dto.Resultado) &&
        ApiProblemResults.SameText(existing.Observaciones, dto.Observaciones);

    internal static EventoReproductivoResponseDto ToResponseDto(EventoReproductivo e) => new()
    {
        IdEventoReproductivo = e.IdEventoReproductivo,
        IdAnimal = e.IdAnimal,
        IdSemental = e.IdSemental,
        Tipo = e.Tipo,
        Fecha = e.Fecha,
        Resultado = e.Resultado,
        Observaciones = e.Observaciones,
        IdAutor = e.IdAutor,
        CreadoEn = e.CreadoEn,
        VersionRegistro = e.VersionRegistro,
        EliminadoEn = e.EliminadoEn
    };
}
