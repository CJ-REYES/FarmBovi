using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/eventos-sanitarios")]
[RanchScope(RanchResource.EventoSanitario)]
public sealed class EventosSanitariosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<EventoSanitarioResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<EventoSanitarioResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var query = db.EventosSanitarios.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(e => e.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = idRancho is { } targetRanch && targetRanch != Guid.Empty
            ? query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && a.IdRancho == targetRanch))
            : query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho)));

        var items = await query.ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(EventoSanitarioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<EventoSanitarioResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El evento sanitario solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(EventoSanitarioResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(EventoSanitarioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<EventoSanitarioResponseDto>> Create(
        [FromServices] RanchAccessService access,
        EventoSanitarioCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdEventoSanitario ?? Guid.NewGuid();

        var existing = await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesEventoSanitario(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un evento sanitario con el identificador proporcionado y contenido diferente o eliminado.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var item = new EventoSanitario
        {
            IdEventoSanitario = id,
            IdAnimal = dto.IdAnimal,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtc(dto.Fecha),
            Sintomas = dto.Sintomas?.Trim(),
            Diagnostico = dto.Diagnostico?.Trim(),
            ProfesionalDiagnostico = dto.ProfesionalDiagnostico?.Trim(),
            EvidenciaDiagnosticoUri = dto.EvidenciaDiagnosticoUri?.Trim(),
            Responsable = dto.Responsable.Trim(),
            Observaciones = dto.Observaciones?.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateEventoSanitarioAsync(item, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        db.EventosSanitarios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            var collision = await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                var collisionRanch = await access.RanchOfAnimalAsync(collision.IdAnimal, ct);
                if (userId is { } uid && collisionRanch is { } ranchId &&
                    await access.CanAccessAsync(uid, ranchId, ct))
                {
                    return collision.EliminadoEn is null && MatchesEventoSanitario(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un evento sanitario con el identificador proporcionado y contenido diferente o eliminado.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("No se pudo crear el evento sanitario; verifica que el animal exista.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdEventoSanitario }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, EventoSanitarioUpdateDto dto, CancellationToken ct)
    {
        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El evento sanitario solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un evento sanitario eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un evento sanitario utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        if (dto.IdAnimal != item.IdAnimal)
            return this.ValidationError("No se permite cambiar el animal asociado a un evento sanitario.", nameof(dto.IdAnimal));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var candidate = new EventoSanitario
        {
            IdEventoSanitario = item.IdEventoSanitario,
            IdAnimal = dto.IdAnimal,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtc(dto.Fecha),
            Sintomas = dto.Sintomas?.Trim(),
            Diagnostico = dto.Diagnostico?.Trim(),
            ProfesionalDiagnostico = dto.ProfesionalDiagnostico?.Trim(),
            EvidenciaDiagnosticoUri = dto.EvidenciaDiagnosticoUri?.Trim(),
            Responsable = dto.Responsable.Trim(),
            Observaciones = dto.Observaciones?.Trim(),
            IdAutor = authorId
        };
        var validationError = await validator.ValidateEventoSanitarioAsync(candidate, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        item.Tipo = candidate.Tipo;
        item.Fecha = candidate.Fecha;
        item.Sintomas = candidate.Sintomas;
        item.Diagnostico = candidate.Diagnostico;
        item.ProfesionalDiagnostico = candidate.ProfesionalDiagnostico;
        item.EvidenciaDiagnosticoUri = candidate.EvidenciaDiagnosticoUri;
        item.Responsable = candidate.Responsable;
        item.Observaciones = candidate.Observaciones;
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("No se pudo actualizar el evento sanitario; verifica las referencias.");
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
        var item = await db.EventosSanitarios.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El evento sanitario solicitado no existe.");

        var hasActiveTratamientos = await db.Tratamientos.AsNoTracking()
            .AnyAsync(t => t.IdEventoSanitario == id && t.EliminadoEn == null, ct);
        if (hasActiveTratamientos)
            return this.ConflictProblem("No se puede eliminar un evento sanitario que tiene tratamientos asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static bool MatchesEventoSanitario(EventoSanitario existing, EventoSanitarioCreateDto dto) =>
        existing.IdAnimal == dto.IdAnimal &&
        ApiProblemResults.SameText(existing.Tipo, dto.Tipo) &&
        ApiProblemResults.SameUtcInstant(existing.Fecha, dto.Fecha) &&
        ApiProblemResults.SameText(existing.Sintomas, dto.Sintomas) &&
        ApiProblemResults.SameText(existing.Diagnostico, dto.Diagnostico) &&
        ApiProblemResults.SameText(existing.ProfesionalDiagnostico, dto.ProfesionalDiagnostico) &&
        ApiProblemResults.SameText(existing.EvidenciaDiagnosticoUri, dto.EvidenciaDiagnosticoUri) &&
        ApiProblemResults.SameText(existing.Responsable, dto.Responsable) &&
        ApiProblemResults.SameText(existing.Observaciones, dto.Observaciones);

    internal static EventoSanitarioResponseDto ToResponseDto(EventoSanitario e) => new()
    {
        IdEventoSanitario = e.IdEventoSanitario,
        IdAnimal = e.IdAnimal,
        Tipo = e.Tipo,
        Fecha = e.Fecha,
        Sintomas = e.Sintomas,
        Diagnostico = e.Diagnostico,
        ProfesionalDiagnostico = e.ProfesionalDiagnostico,
        EvidenciaDiagnosticoUri = e.EvidenciaDiagnosticoUri,
        Responsable = e.Responsable,
        Observaciones = e.Observaciones,
        IdAutor = e.IdAutor,
        CreadoEn = e.CreadoEn,
        VersionRegistro = e.VersionRegistro,
        EliminadoEn = e.EliminadoEn
    };
}
