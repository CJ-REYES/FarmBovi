using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.MovimientoAnimal)]
[Route("api/movimientos-animales")]
public sealed class MovimientoAnimalController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<MovimientoAnimalResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<MovimientoAnimalResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.MovimientosAnimales.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho)));

        var items = await query.OrderBy(m => m.Fecha).Select(m => ToResponseDto(m)).ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(MovimientoAnimalResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<MovimientoAnimalResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El movimiento de animal solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(MovimientoAnimalResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(MovimientoAnimalResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<MovimientoAnimalResponseDto>> Create(
        [FromServices] RanchAccessService access, MovimientoAnimalCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdMovimiento ?? Guid.NewGuid();

        var existing = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (existing is not null)
        {
            return MatchesMovimiento(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un movimiento con el identificador proporcionado y contenido diferente.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var movimiento = new MovimientoAnimal
        {
            IdMovimiento = id,
            IdAnimal = dto.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtc(dto.Fecha),
            OrigenExterno = dto.OrigenExterno?.Trim(),
            DestinoExterno = dto.DestinoExterno?.Trim(),
            Motivo = dto.Motivo?.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var (animal, error) = await validator.ValidateAndPrepareMovimientoAsync(movimiento, ct);
        if (error is not null) return this.ValidationError(error);

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        if (animal is not null)
        {
            var tipo = movimiento.Tipo.Trim();
            if (tipo.Equals("Alta", StringComparison.OrdinalIgnoreCase) ||
                tipo.Equals("CambioInterno", StringComparison.OrdinalIgnoreCase) ||
                tipo.Equals("Cambio interno", StringComparison.OrdinalIgnoreCase) ||
                tipo.Equals("Traslado", StringComparison.OrdinalIgnoreCase))
            {
                animal.IdLote = movimiento.IdLoteDestino;
                animal.VersionRegistro++;
            }
            else if (tipo.Equals("Venta", StringComparison.OrdinalIgnoreCase) ||
                     tipo.Equals("Baja", StringComparison.OrdinalIgnoreCase))
            {
                animal.IdLote = null;
                animal.Estado = tipo.Equals("Venta", StringComparison.OrdinalIgnoreCase) ? "Vendido" : "Baja";
                animal.FechaSalida = movimiento.Fecha;
                animal.VersionRegistro++;
            }
        }

        db.MovimientosAnimales.Add(movimiento);
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);

            var collision = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
            if (collision is not null)
            {
                var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
                var belongsToRanch = db.Animales.Any(a => a.IdAnimal == collision.IdAnimal && ranchIds.Contains(a.IdRancho));
                if (belongsToRanch)
                {
                    return MatchesMovimiento(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un movimiento con el identificador proporcionado y contenido diferente.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("No se pudo registrar el movimiento; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = movimiento.IdMovimiento }, ToResponseDto(movimiento));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, MovimientoAnimalUpdateDto dto, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El movimiento de animal solicitado no existe.");

        if (dto.IdAnimal != item.IdAnimal)
            return this.ValidationError("No se permite cambiar el animal asociado a un movimiento.", nameof(dto.IdAnimal));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var candidate = new MovimientoAnimal
        {
            IdMovimiento = item.IdMovimiento,
            IdAnimal = dto.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtc(dto.Fecha),
            OrigenExterno = dto.OrigenExterno?.Trim(),
            DestinoExterno = dto.DestinoExterno?.Trim(),
            Motivo = dto.Motivo?.Trim(),
            IdAutor = authorId
        };
        var (animal, error) = await validator.ValidateAndPrepareMovimientoAsync(candidate, ct);
        if (error is not null) return this.ValidationError(error);

        item.IdAnimal = dto.IdAnimal;
        item.IdLoteOrigen = dto.IdLoteOrigen;
        item.IdLoteDestino = dto.IdLoteDestino;
        item.Tipo = candidate.Tipo;
        item.Fecha = candidate.Fecha;
        item.OrigenExterno = candidate.OrigenExterno;
        item.DestinoExterno = candidate.DestinoExterno;
        item.Motivo = candidate.Motivo;
        item.IdAutor = authorId;
        item.EliminadoEn = ApiProblemResults.EnsureUtc(dto.EliminadoEn);
        item.VersionRegistro++;

        if (animal is not null)
        {
            var tipo = item.Tipo.Trim();
            if (tipo.Equals("Alta", StringComparison.OrdinalIgnoreCase) ||
                tipo.Equals("CambioInterno", StringComparison.OrdinalIgnoreCase) ||
                tipo.Equals("Cambio interno", StringComparison.OrdinalIgnoreCase) ||
                tipo.Equals("Traslado", StringComparison.OrdinalIgnoreCase))
            {
                animal.IdLote = item.IdLoteDestino;
                animal.VersionRegistro++;
            }
            else if (tipo.Equals("Venta", StringComparison.OrdinalIgnoreCase) ||
                     tipo.Equals("Baja", StringComparison.OrdinalIgnoreCase))
            {
                animal.IdLote = null;
                animal.Estado = tipo.Equals("Venta", StringComparison.OrdinalIgnoreCase) ? "Vendido" : "Baja";
                animal.FechaSalida = item.Fecha;
                animal.VersionRegistro++;
            }
        }

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return this.ConflictProblem("No se pudo actualizar el movimiento; verifica las referencias.");
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
        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El movimiento de animal solicitado no existe.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static bool MatchesMovimiento(MovimientoAnimal existing, MovimientoAnimalCreateDto dto) =>
        existing.IdAnimal == dto.IdAnimal &&
        existing.IdLoteOrigen == dto.IdLoteOrigen &&
        existing.IdLoteDestino == dto.IdLoteDestino &&
        ApiProblemResults.SameText(existing.Tipo, dto.Tipo) &&
        ApiProblemResults.SameUtcInstant(existing.Fecha, dto.Fecha) &&
        ApiProblemResults.SameText(existing.OrigenExterno, dto.OrigenExterno) &&
        ApiProblemResults.SameText(existing.DestinoExterno, dto.DestinoExterno) &&
        ApiProblemResults.SameText(existing.Motivo, dto.Motivo);

    private static MovimientoAnimalResponseDto ToResponseDto(MovimientoAnimal m) => new()
    {
        IdMovimiento = m.IdMovimiento,
        IdAnimal = m.IdAnimal,
        IdLoteOrigen = m.IdLoteOrigen,
        IdLoteDestino = m.IdLoteDestino,
        Tipo = m.Tipo,
        Fecha = m.Fecha,
        OrigenExterno = m.OrigenExterno,
        DestinoExterno = m.DestinoExterno,
        Motivo = m.Motivo,
        IdAutor = m.IdAutor,
        CreadoEn = m.CreadoEn,
        VersionRegistro = m.VersionRegistro,
        EliminadoEn = m.EliminadoEn
    };
}
