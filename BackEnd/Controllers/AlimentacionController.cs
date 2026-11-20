using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.Alimentacion)]
[Route("api/alimentacion")]
public sealed class AlimentacionController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<AlimentacionResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<AlimentacionResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Alimentaciones.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        // Solo registros de ranchos donde el usuario tiene membresía activa.
        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => (x.IdAnimal != null && db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho))) || (x.IdAnimal == null && x.IdLote != null && db.Lotes.Any(l => l.IdLote == x.IdLote && ranchIds.Contains(l.IdRancho))));

        var items = await query.Select(a => ToResponseDto(a)).ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(AlimentacionResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AlimentacionResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : NotFound();

    [HttpPost]
    [ProducesResponseType(typeof(AlimentacionResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(AlimentacionResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<AlimentacionResponseDto>> Create(AlimentacionCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdAlimentacion is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(a => a.IdAlimentacion == id, ct);
        if (existing is not null)
            return Ok(ToResponseDto(existing));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var inicio = dto.Inicio == default ? DateTime.UtcNow : dto.Inicio;
        var validationError = await validator.ValidateAlimentacionAsync(dto.IdAnimal, dto.IdLote, dto.Cantidad, inicio, dto.Fin, ct);
        if (validationError is not null) return BadRequest(validationError);

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
            Fin = dto.Fin,
            CambioDieta = dto.CambioDieta,
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Alimentaciones.Add(alimentacion);
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo registrar la alimentación; verifica las referencias.");
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
    public async Task<IActionResult> Update(Guid id, AlimentacionUpdateDto dto, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.Alimentaciones.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var validationError = await validator.ValidateAlimentacionAsync(dto.IdAnimal, dto.IdLote, dto.Cantidad, dto.Inicio, dto.Fin, ct);
        if (validationError is not null) return BadRequest(validationError);

        item.IdAnimal = dto.IdAnimal;
        item.IdLote = dto.IdLote;
        item.Alimento = dto.Alimento.Trim();
        item.Racion = dto.Racion.Trim();
        item.Cantidad = dto.Cantidad;
        item.Unidad = dto.Unidad.Trim();
        item.Frecuencia = dto.Frecuencia.Trim();
        item.Inicio = dto.Inicio;
        item.Fin = dto.Fin;
        item.CambioDieta = dto.CambioDieta;
        item.IdAutor = authorId;
        item.EliminadoEn = dto.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo actualizar la alimentación; verifica las referencias.");
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
        if (item is null) return NotFound();

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static AlimentacionResponseDto ToResponseDto(Alimentacion a) => new()
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
        VersionRegistro = a.VersionRegistro
    };
}
