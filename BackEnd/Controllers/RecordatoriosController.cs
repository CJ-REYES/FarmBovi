using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.Recordatorio)]
[Route("api/recordatorios")]
public sealed class RecordatoriosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<RecordatorioResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<RecordatorioResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Recordatorios.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        // Solo registros de ranchos donde el usuario tiene membresía activa.
        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => ranchIds.Contains(x.IdRancho));

        var items = await query.Select(r => ToResponseDto(r)).ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(RecordatorioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RecordatorioResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Recordatorios.AsNoTracking().FirstOrDefaultAsync(r => r.IdRecordatorio == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : NotFound();

    [HttpPost]
    [ProducesResponseType(typeof(RecordatorioResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(RecordatorioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RecordatorioResponseDto>> Create(RecordatorioCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdRecordatorio is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Recordatorios.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRecordatorio == id, ct);
        if (existing is not null)
            return Ok(ToResponseDto(existing));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var estado = dto.Estado.Trim();
        var item = new Recordatorio
        {
            IdRecordatorio = id,
            IdRancho = dto.IdRancho,
            IdAnimal = dto.IdAnimal,
            IdLote = dto.IdLote,
            IdTratamiento = dto.IdTratamiento,
            IdResponsable = dto.IdResponsable,
            Tipo = dto.Tipo.Trim(),
            Descripcion = dto.Descripcion.Trim(),
            FechaProgramada = dto.FechaProgramada == default ? DateTime.UtcNow : dto.FechaProgramada,
            Estado = estado,
            FechaCompletado = string.Equals(estado, "Completado", StringComparison.OrdinalIgnoreCase) && dto.FechaCompletado is null
                ? DateTime.UtcNow
                : dto.FechaCompletado,
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateRecordatorioAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        db.Recordatorios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el recordatorio; verifica que el rancho y las referencias existan.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdRecordatorio }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, RecordatorioUpdateDto dto, CancellationToken ct)
    {
        var item = await db.Recordatorios.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return BadRequest(authorError);

        var candidate = new Recordatorio
        {
            IdRecordatorio = item.IdRecordatorio,
            IdRancho = dto.IdRancho,
            IdAnimal = dto.IdAnimal,
            IdLote = dto.IdLote,
            IdTratamiento = dto.IdTratamiento,
            IdResponsable = dto.IdResponsable,
            Tipo = dto.Tipo.Trim(),
            Descripcion = dto.Descripcion.Trim(),
            FechaProgramada = dto.FechaProgramada,
            Estado = dto.Estado.Trim(),
            FechaCompletado = dto.FechaCompletado,
            IdAutor = authorId
        };
        var validationError = await validator.ValidateRecordatorioAsync(candidate, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdRancho = candidate.IdRancho;
        item.IdAnimal = candidate.IdAnimal;
        item.IdLote = candidate.IdLote;
        item.IdTratamiento = candidate.IdTratamiento;
        item.IdResponsable = candidate.IdResponsable;
        item.Tipo = candidate.Tipo;
        item.Descripcion = candidate.Descripcion;
        item.FechaProgramada = candidate.FechaProgramada;
        item.Estado = candidate.Estado;
        item.FechaCompletado = string.Equals(candidate.Estado, "Completado", StringComparison.OrdinalIgnoreCase)
            ? (dto.FechaCompletado ?? item.FechaCompletado ?? DateTime.UtcNow)
            : dto.FechaCompletado;
        item.IdAutor = authorId;
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
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Recordatorios.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static RecordatorioResponseDto ToResponseDto(Recordatorio r) => new()
    {
        IdRecordatorio = r.IdRecordatorio,
        IdRancho = r.IdRancho,
        IdAnimal = r.IdAnimal,
        IdLote = r.IdLote,
        IdTratamiento = r.IdTratamiento,
        IdResponsable = r.IdResponsable,
        Tipo = r.Tipo,
        Descripcion = r.Descripcion,
        FechaProgramada = r.FechaProgramada,
        Estado = r.Estado,
        FechaCompletado = r.FechaCompletado,
        IdAutor = r.IdAutor,
        CreadoEn = r.CreadoEn,
        VersionRegistro = r.VersionRegistro
    };
}
