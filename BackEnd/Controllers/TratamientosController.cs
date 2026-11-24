using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/tratamientos")]
[RanchScope(RanchResource.Tratamiento)]
public sealed class TratamientosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<TratamientoResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<TratamientoResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var query = db.Tratamientos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(t => t.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = idRancho is { } targetRanch && targetRanch != Guid.Empty
            ? query.Where(x => db.EventosSanitarios.Any(e => e.IdEventoSanitario == x.IdEventoSanitario &&
                                                              db.Animales.Any(a => a.IdAnimal == e.IdAnimal && a.IdRancho == targetRanch)))
            : query.Where(x => db.EventosSanitarios.Any(e => e.IdEventoSanitario == x.IdEventoSanitario &&
                                                              db.Animales.Any(a => a.IdAnimal == e.IdAnimal && ranchIds.Contains(a.IdRancho))));

        var items = await query.ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(TratamientoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TratamientoResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(t => t.IdTratamiento == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El tratamiento solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(TratamientoResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(TratamientoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TratamientoResponseDto>> Create(
        [FromServices] RanchAccessService access,
        TratamientoCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdTratamiento ?? Guid.NewGuid();

        var existing = await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(t => t.IdTratamiento == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesTratamiento(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un tratamiento con el identificador proporcionado y contenido diferente o eliminado.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var item = new Tratamiento
        {
            IdTratamiento = id,
            IdEventoSanitario = dto.IdEventoSanitario,
            Producto = dto.Producto.Trim(),
            Dosis = dto.Dosis,
            UnidadDosis = dto.UnidadDosis.Trim(),
            ViaAdministracion = dto.ViaAdministracion?.Trim(),
            Frecuencia = dto.Frecuencia.Trim(),
            FechaInicio = ApiProblemResults.EnsureUtc(dto.FechaInicio),
            FechaFin = ApiProblemResults.EnsureUtc(dto.FechaFin),
            Responsable = dto.Responsable.Trim(),
            PrescripcionUri = dto.PrescripcionUri?.Trim(),
            Estado = dto.Estado.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateTratamientoAsync(item, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        db.Tratamientos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            var collision = await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(t => t.IdTratamiento == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                var collisionRanch = await access.RanchOfEventoSanitarioAsync(collision.IdEventoSanitario, ct);
                if (userId is { } uid && collisionRanch is { } ranchId &&
                    await access.CanAccessAsync(uid, ranchId, ct))
                {
                    return collision.EliminadoEn is null && MatchesTratamiento(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un tratamiento con el identificador proporcionado y contenido diferente o eliminado.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("No se pudo crear el tratamiento; verifica que el evento sanitario exista.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdTratamiento }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, TratamientoUpdateDto dto, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El tratamiento solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un tratamiento eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un tratamiento utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        if (dto.IdEventoSanitario != item.IdEventoSanitario)
            return this.ValidationError("No se permite cambiar el evento sanitario asociado a un tratamiento.", nameof(dto.IdEventoSanitario));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var candidate = new Tratamiento
        {
            IdTratamiento = item.IdTratamiento,
            IdEventoSanitario = dto.IdEventoSanitario,
            Producto = dto.Producto.Trim(),
            Dosis = dto.Dosis,
            UnidadDosis = dto.UnidadDosis.Trim(),
            ViaAdministracion = dto.ViaAdministracion?.Trim(),
            Frecuencia = dto.Frecuencia.Trim(),
            FechaInicio = ApiProblemResults.EnsureUtc(dto.FechaInicio),
            FechaFin = ApiProblemResults.EnsureUtc(dto.FechaFin),
            Responsable = dto.Responsable.Trim(),
            PrescripcionUri = dto.PrescripcionUri?.Trim(),
            Estado = dto.Estado.Trim(),
            IdAutor = authorId
        };
        var validationError = await validator.ValidateTratamientoAsync(candidate, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        item.Producto = candidate.Producto;
        item.Dosis = candidate.Dosis;
        item.UnidadDosis = candidate.UnidadDosis;
        item.ViaAdministracion = candidate.ViaAdministracion;
        item.Frecuencia = candidate.Frecuencia;
        item.FechaInicio = candidate.FechaInicio;
        item.FechaFin = candidate.FechaFin;
        item.Responsable = candidate.Responsable;
        item.PrescripcionUri = candidate.PrescripcionUri;
        item.Estado = candidate.Estado;
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("No se pudo actualizar el tratamiento; verifica las referencias.");
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
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El tratamiento solicitado no existe.");

        var hasActiveRecordatorios = await db.Recordatorios.AsNoTracking()
            .AnyAsync(r => r.IdTratamiento == id && r.EliminadoEn == null, ct);
        if (hasActiveRecordatorios)
            return this.ConflictProblem("No se puede eliminar un tratamiento que tiene recordatorios asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static bool MatchesTratamiento(Tratamiento existing, TratamientoCreateDto dto) =>
        existing.IdEventoSanitario == dto.IdEventoSanitario &&
        ApiProblemResults.SameText(existing.Producto, dto.Producto) &&
        existing.Dosis == dto.Dosis &&
        ApiProblemResults.SameText(existing.UnidadDosis, dto.UnidadDosis) &&
        ApiProblemResults.SameText(existing.ViaAdministracion, dto.ViaAdministracion) &&
        ApiProblemResults.SameText(existing.Frecuencia, dto.Frecuencia) &&
        ApiProblemResults.SameUtcInstant(existing.FechaInicio, dto.FechaInicio) &&
        ApiProblemResults.SameUtcInstant(existing.FechaFin, dto.FechaFin) &&
        ApiProblemResults.SameText(existing.Responsable, dto.Responsable) &&
        ApiProblemResults.SameText(existing.PrescripcionUri, dto.PrescripcionUri) &&
        ApiProblemResults.SameText(existing.Estado, dto.Estado);

    internal static TratamientoResponseDto ToResponseDto(Tratamiento t) => new()
    {
        IdTratamiento = t.IdTratamiento,
        IdEventoSanitario = t.IdEventoSanitario,
        Producto = t.Producto,
        Dosis = t.Dosis,
        UnidadDosis = t.UnidadDosis,
        ViaAdministracion = t.ViaAdministracion,
        Frecuencia = t.Frecuencia,
        FechaInicio = t.FechaInicio,
        FechaFin = t.FechaFin,
        Responsable = t.Responsable,
        PrescripcionUri = t.PrescripcionUri,
        Estado = t.Estado,
        IdAutor = t.IdAutor,
        CreadoEn = t.CreadoEn,
        VersionRegistro = t.VersionRegistro,
        EliminadoEn = t.EliminadoEn
    };
}
