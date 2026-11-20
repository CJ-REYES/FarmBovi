using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.EventoSanitario)]
[Route("api/eventos-sanitarios")]
public sealed class EventosSanitariosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<EventoSanitarioResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<EventoSanitarioResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.EventosSanitarios.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(e => e.EliminadoEn == null);

        // Solo registros de ranchos donde el usuario tiene membresía activa.
        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho)));

        var items = await query.Select(e => ToResponseDto(e)).ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(EventoSanitarioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<EventoSanitarioResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : NotFound();

    [HttpPost]
    [ProducesResponseType(typeof(EventoSanitarioResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(EventoSanitarioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<EventoSanitarioResponseDto>> Create(EventoSanitarioCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdEventoSanitario is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.EventosSanitarios.AsNoTracking()
            .FirstOrDefaultAsync(e => e.IdEventoSanitario == id, ct);
        if (existing is not null)
            return Ok(ToResponseDto(existing));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var item = new EventoSanitario
        {
            IdEventoSanitario = id,
            IdAnimal = dto.IdAnimal,
            Tipo = dto.Tipo.Trim(),
            Fecha = dto.Fecha == default ? DateTime.UtcNow : dto.Fecha,
            Sintomas = dto.Sintomas,
            Diagnostico = dto.Diagnostico,
            ProfesionalDiagnostico = dto.ProfesionalDiagnostico,
            EvidenciaDiagnosticoUri = dto.EvidenciaDiagnosticoUri,
            Responsable = dto.Responsable.Trim(),
            Observaciones = dto.Observaciones,
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateEventoSanitarioAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        db.EventosSanitarios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el evento sanitario; verifica que el animal exista.");
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
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return BadRequest(authorError);

        var candidate = new EventoSanitario
        {
            IdEventoSanitario = item.IdEventoSanitario,
            IdAnimal = dto.IdAnimal,
            Tipo = dto.Tipo.Trim(),
            Fecha = dto.Fecha,
            Sintomas = dto.Sintomas,
            Diagnostico = dto.Diagnostico,
            ProfesionalDiagnostico = dto.ProfesionalDiagnostico,
            EvidenciaDiagnosticoUri = dto.EvidenciaDiagnosticoUri,
            Responsable = dto.Responsable.Trim(),
            Observaciones = dto.Observaciones,
            IdAutor = authorId
        };
        var validationError = await validator.ValidateEventoSanitarioAsync(candidate, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAnimal = candidate.IdAnimal;
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
            return Conflict("No se pudo actualizar el evento sanitario; verifica las referencias.");
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
        if (item is null) return NotFound();

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

    private static EventoSanitarioResponseDto ToResponseDto(EventoSanitario e) => new()
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
        VersionRegistro = e.VersionRegistro
    };
}
