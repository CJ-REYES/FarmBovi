using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.Tratamiento)]
[Route("api/tratamientos")]
public sealed class TratamientosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<TratamientoResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<TratamientoResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Tratamientos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(t => t.EliminadoEn == null);

        // Solo registros de ranchos donde el usuario tiene membresía activa.
        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => db.EventosSanitarios.Any(e => e.IdEventoSanitario == x.IdEventoSanitario && db.Animales.Any(a => a.IdAnimal == e.IdAnimal && ranchIds.Contains(a.IdRancho))));

        var items = await query.Select(t => ToResponseDto(t)).ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(TratamientoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TratamientoResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(t => t.IdTratamiento == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : NotFound();

    [HttpPost]
    [ProducesResponseType(typeof(TratamientoResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(TratamientoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TratamientoResponseDto>> Create(TratamientoCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdTratamiento is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Tratamientos.AsNoTracking()
            .FirstOrDefaultAsync(t => t.IdTratamiento == id, ct);
        if (existing is not null)
            return Ok(ToResponseDto(existing));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var item = new Tratamiento
        {
            IdTratamiento = id,
            IdEventoSanitario = dto.IdEventoSanitario,
            Producto = dto.Producto.Trim(),
            Dosis = dto.Dosis,
            UnidadDosis = dto.UnidadDosis.Trim(),
            ViaAdministracion = dto.ViaAdministracion,
            Frecuencia = dto.Frecuencia.Trim(),
            FechaInicio = dto.FechaInicio == default ? DateTime.UtcNow : dto.FechaInicio,
            FechaFin = dto.FechaFin,
            Responsable = dto.Responsable.Trim(),
            PrescripcionUri = dto.PrescripcionUri,
            Estado = dto.Estado.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateTratamientoAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        db.Tratamientos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el tratamiento; verifica que el evento sanitario exista.");
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
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return BadRequest(authorError);

        var candidate = new Tratamiento
        {
            IdTratamiento = item.IdTratamiento,
            IdEventoSanitario = dto.IdEventoSanitario,
            Producto = dto.Producto.Trim(),
            Dosis = dto.Dosis,
            UnidadDosis = dto.UnidadDosis.Trim(),
            ViaAdministracion = dto.ViaAdministracion,
            Frecuencia = dto.Frecuencia.Trim(),
            FechaInicio = dto.FechaInicio,
            FechaFin = dto.FechaFin,
            Responsable = dto.Responsable.Trim(),
            PrescripcionUri = dto.PrescripcionUri,
            Estado = dto.Estado.Trim(),
            IdAutor = authorId
        };
        var validationError = await validator.ValidateTratamientoAsync(candidate, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdEventoSanitario = candidate.IdEventoSanitario;
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
            return Conflict("No se pudo actualizar el tratamiento; verifica las referencias.");
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
        if (item is null) return NotFound();

        var hasActiveRecordatorios = await db.Recordatorios.AsNoTracking()
            .AnyAsync(r => r.IdTratamiento == id && r.EliminadoEn == null, ct);
        if (hasActiveRecordatorios)
            return Conflict("No se puede eliminar un tratamiento que tiene recordatorios asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static TratamientoResponseDto ToResponseDto(Tratamiento t) => new()
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
        VersionRegistro = t.VersionRegistro
    };
}
