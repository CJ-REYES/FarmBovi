using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/recordatorios")]
[RanchScope(RanchResource.Recordatorio)]
public sealed class RecordatoriosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<RecordatorioResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<RecordatorioResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var query = db.Recordatorios.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => ranchIds.Contains(x.IdRancho));
        if (idRancho is { } targetRanch && targetRanch != Guid.Empty)
            query = query.Where(x => x.IdRancho == targetRanch);

        var items = await query.ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(RecordatorioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RecordatorioResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Recordatorios.AsNoTracking().FirstOrDefaultAsync(r => r.IdRecordatorio == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El recordatorio solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(RecordatorioResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(RecordatorioResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RecordatorioResponseDto>> Create(
        [FromServices] RanchAccessService access,
        RecordatorioCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdRecordatorio ?? Guid.NewGuid();

        var existing = await db.Recordatorios.AsNoTracking().FirstOrDefaultAsync(r => r.IdRecordatorio == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesRecordatorio(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un recordatorio con el identificador proporcionado y contenido diferente o eliminado.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

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
            FechaProgramada = ApiProblemResults.EnsureUtc(dto.FechaProgramada),
            Estado = estado,
            FechaCompletado = string.Equals(estado, "Completado", StringComparison.OrdinalIgnoreCase) && dto.FechaCompletado is null
                ? DateTime.UtcNow
                : ApiProblemResults.EnsureUtc(dto.FechaCompletado),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateRecordatorioAsync(item, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        db.Recordatorios.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            var collision = await db.Recordatorios.AsNoTracking().FirstOrDefaultAsync(r => r.IdRecordatorio == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                if (userId is { } uid && await access.CanAccessAsync(uid, collision.IdRancho, ct))
                {
                    return collision.EliminadoEn is null && MatchesRecordatorio(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un recordatorio con el identificador proporcionado y contenido diferente o eliminado.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("No se pudo crear el recordatorio; verifica que el rancho y las referencias existan.");
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
        if (item is null) return this.NotFoundProblem("El recordatorio solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un recordatorio eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un recordatorio utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        if (dto.IdRancho != item.IdRancho)
            return this.ValidationError("No se permite transferir un recordatorio a otro rancho mediante actualización directa.", nameof(dto.IdRancho));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var estado = dto.Estado.Trim();
        var candidate = new Recordatorio
        {
            IdRecordatorio = item.IdRecordatorio,
            IdRancho = item.IdRancho,
            IdAnimal = dto.IdAnimal,
            IdLote = dto.IdLote,
            IdTratamiento = dto.IdTratamiento,
            IdResponsable = dto.IdResponsable,
            Tipo = dto.Tipo.Trim(),
            Descripcion = dto.Descripcion.Trim(),
            FechaProgramada = ApiProblemResults.EnsureUtc(dto.FechaProgramada),
            Estado = estado,
            FechaCompletado = string.Equals(estado, "Completado", StringComparison.OrdinalIgnoreCase)
                ? (ApiProblemResults.EnsureUtc(dto.FechaCompletado) ?? item.FechaCompletado ?? DateTime.UtcNow)
                : ApiProblemResults.EnsureUtc(dto.FechaCompletado),
            IdAutor = authorId
        };
        var validationError = await validator.ValidateRecordatorioAsync(candidate, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        item.IdAnimal = candidate.IdAnimal;
        item.IdLote = candidate.IdLote;
        item.IdTratamiento = candidate.IdTratamiento;
        item.IdResponsable = candidate.IdResponsable;
        item.Tipo = candidate.Tipo;
        item.Descripcion = candidate.Descripcion;
        item.FechaProgramada = candidate.FechaProgramada;
        item.Estado = candidate.Estado;
        item.FechaCompletado = candidate.FechaCompletado;
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("No se pudo actualizar el recordatorio; verifica las referencias.");
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
        if (item is null) return this.NotFoundProblem("El recordatorio solicitado no existe.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static bool MatchesRecordatorio(Recordatorio existing, RecordatorioCreateDto dto)
    {
        if (existing.IdRancho != dto.IdRancho ||
            existing.IdAnimal != dto.IdAnimal ||
            existing.IdLote != dto.IdLote ||
            existing.IdTratamiento != dto.IdTratamiento ||
            existing.IdResponsable != dto.IdResponsable ||
            !ApiProblemResults.SameText(existing.Tipo, dto.Tipo) ||
            !ApiProblemResults.SameText(existing.Descripcion, dto.Descripcion) ||
            !ApiProblemResults.SameUtcInstant(existing.FechaProgramada, dto.FechaProgramada) ||
            !ApiProblemResults.SameText(existing.Estado, dto.Estado))
        {
            return false;
        }

        if (dto.FechaCompletado.HasValue)
        {
            return ApiProblemResults.SameUtcInstant(existing.FechaCompletado, dto.FechaCompletado);
        }

        if (string.Equals(dto.Estado.Trim(), "Completado", StringComparison.OrdinalIgnoreCase))
        {
            return existing.FechaCompletado.HasValue;
        }

        return !existing.FechaCompletado.HasValue;
    }

    internal static RecordatorioResponseDto ToResponseDto(Recordatorio r) => new()
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
        VersionRegistro = r.VersionRegistro,
        EliminadoEn = r.EliminadoEn
    };
}
