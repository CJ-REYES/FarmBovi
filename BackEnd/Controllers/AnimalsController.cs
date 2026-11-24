using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/animales")]
[RanchScope(RanchResource.Animal)]
public sealed class AnimalsController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<AnimalResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<AnimalResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.Animales.AsNoTracking()
            .Where(a => ranchIds.Contains(a.IdRancho));

        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        if (idRancho is { } targetRanch && targetRanch != Guid.Empty)
            query = query.Where(x => x.IdRancho == targetRanch);

        var items = await query.ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(AnimalResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AnimalResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : this.NotFoundProblem("El animal solicitado no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(AnimalResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(AnimalResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<AnimalResponseDto>> Create(
        [FromServices] RanchAccessService access,
        AnimalCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdAnimal ?? Guid.NewGuid();

        var existing = await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesAnimal(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un animal con el identificador proporcionado y contenido diferente o eliminado.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? 0, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));
        var item = new Animal
        {
            IdAnimal = id,
            IdRancho = dto.IdRancho,
            IdLote = dto.IdLote,
            Arete = dto.Arete.Trim(),
            Raza = dto.Raza.Trim(),
            Sexo = dto.Sexo.Trim(),
            FechaNacimiento = ApiProblemResults.EnsureUtcDate(dto.FechaNacimiento),
            FechaIngreso = ApiProblemResults.EnsureUtcDate(dto.FechaIngreso),
            Procedencia = dto.Procedencia.Trim(),
            Estado = dto.Estado.Trim(),
            FechaSalida = ApiProblemResults.EnsureUtcDate(dto.FechaSalida),
            Observaciones = dto.Observaciones?.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateAnimalAsync(item, excludeAnimalId: null, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;
        db.Animales.Add(item);

        // Regla 06: Registrar el alta inicial en MovimientoAnimal para mantener trazabilidad completa.
        db.MovimientosAnimales.Add(new MovimientoAnimal
        {
            IdMovimiento = Guid.NewGuid(),
            IdAnimal = item.IdAnimal,
            IdLoteOrigen = null,
            IdLoteDestino = item.IdLote,
            Tipo = "Alta",
            Fecha = item.FechaIngreso,
            OrigenExterno = item.Procedencia,
            Motivo = "Registro inicial del animal",
            IdAutor = authorId,
            VersionRegistro = 1
        });

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);

            var collision = await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                if (userId is { } uid && await access.CanAccessAsync(uid, collision.IdRancho, ct))
                {
                    return collision.EliminadoEn is null && MatchesAnimal(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un animal con el identificador proporcionado y contenido diferente o eliminado.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("El arete ya existe en este rancho o las referencias no son válidas.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdAnimal }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, AnimalUpdateDto dto, CancellationToken ct)
    {
        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El animal solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un animal eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un animal utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        if (dto.IdRancho.HasValue && dto.IdRancho.Value != item.IdRancho)
        {
            return this.ValidationError(
                "No se permite transferir un animal a otro rancho mediante actualización directa; use el flujo de movimientos.",
                nameof(dto.IdRancho));
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? 0, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var candidate = new Animal
        {
            IdAnimal = item.IdAnimal,
            IdRancho = item.IdRancho,
            IdLote = dto.IdLote,
            Arete = dto.Arete.Trim(),
            Raza = dto.Raza.Trim(),
            Sexo = dto.Sexo.Trim(),
            FechaNacimiento = ApiProblemResults.EnsureUtcDate(dto.FechaNacimiento),
            FechaIngreso = ApiProblemResults.EnsureUtcDate(dto.FechaIngreso),
            Procedencia = dto.Procedencia.Trim(),
            Estado = dto.Estado.Trim(),
            FechaSalida = ApiProblemResults.EnsureUtcDate(dto.FechaSalida),
            Observaciones = dto.Observaciones?.Trim(),
            IdAutor = authorId
        };
        var validationError = await validator.ValidateAnimalAsync(candidate, excludeAnimalId: id, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        var loteAnterior = item.IdLote;
        var estadoAnterior = item.Estado;

        item.IdLote = candidate.IdLote;
        item.Arete = candidate.Arete;
        item.Raza = candidate.Raza;
        item.Sexo = candidate.Sexo;
        item.FechaNacimiento = candidate.FechaNacimiento;
        item.FechaIngreso = candidate.FechaIngreso;
        item.Procedencia = candidate.Procedencia;
        item.Estado = candidate.Estado;
        item.FechaSalida = candidate.FechaSalida;
        item.Observaciones = candidate.Observaciones;
        item.IdAutor = authorId;
        item.VersionRegistro++;

        var esSalida = !string.Equals(estadoAnterior, item.Estado, StringComparison.OrdinalIgnoreCase) &&
                       (item.Estado.Equals("Vendido", StringComparison.OrdinalIgnoreCase) ||
                        item.Estado.Equals("Venta", StringComparison.OrdinalIgnoreCase) ||
                        item.Estado.Equals("Baja", StringComparison.OrdinalIgnoreCase));

        // Regla 06 y 08: Registrar cambio de lote o salida en MovimientoAnimal sin perder historial.
        if (esSalida)
        {
            item.FechaSalida ??= ApiProblemResults.EnsureUtcDate(DateTime.UtcNow);
            db.MovimientosAnimales.Add(new MovimientoAnimal
            {
                IdMovimiento = Guid.NewGuid(),
                IdAnimal = item.IdAnimal,
                IdLoteOrigen = loteAnterior,
                IdLoteDestino = null,
                Tipo = item.Estado.StartsWith("Ven", StringComparison.OrdinalIgnoreCase) ? "Venta" : "Baja",
                Fecha = item.FechaSalida.Value,
                Motivo = "Salida registrada en expediente",
                IdAutor = authorId,
                CreadoEn = DateTime.UtcNow,
                VersionRegistro = 1
            });
        }
        else if (loteAnterior != item.IdLote)
        {
            db.MovimientosAnimales.Add(new MovimientoAnimal
            {
                IdMovimiento = Guid.NewGuid(),
                IdAnimal = item.IdAnimal,
                IdLoteOrigen = loteAnterior,
                IdLoteDestino = item.IdLote,
                Tipo = "CambioInterno",
                Fecha = DateTime.UtcNow,
                Motivo = "Actualización de lote en expediente",
                IdAutor = authorId,
                VersionRegistro = 1
            });
        }

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return this.ConflictProblem("El arete ya existe en este rancho o las referencias no son válidas.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(
        [FromServices] RanchAccessService access,
        Guid id,
        CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El animal solicitado no existe.");

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static bool MatchesAnimal(Animal existing, AnimalCreateDto dto) =>
        existing.IdRancho == dto.IdRancho &&
        existing.IdLote == dto.IdLote &&
        ApiProblemResults.SameText(existing.Arete, dto.Arete) &&
        ApiProblemResults.SameText(existing.Raza, dto.Raza) &&
        ApiProblemResults.SameText(existing.Sexo, dto.Sexo) &&
        ApiProblemResults.SameUtcDate(existing.FechaNacimiento, dto.FechaNacimiento) &&
        ApiProblemResults.SameUtcDate(existing.FechaIngreso, dto.FechaIngreso) &&
        ApiProblemResults.SameText(existing.Procedencia, dto.Procedencia) &&
        ApiProblemResults.SameText(existing.Estado, dto.Estado) &&
        ApiProblemResults.SameUtcDate(existing.FechaSalida, dto.FechaSalida) &&
        ApiProblemResults.SameText(existing.Observaciones, dto.Observaciones);

    internal static AnimalResponseDto ToResponseDto(Animal a) => new()
    {
        IdAnimal = a.IdAnimal,
        IdRancho = a.IdRancho,
        IdLote = a.IdLote,
        Arete = a.Arete,
        Raza = a.Raza,
        Sexo = a.Sexo,
        FechaNacimiento = a.FechaNacimiento,
        FechaIngreso = a.FechaIngreso,
        Procedencia = a.Procedencia,
        Estado = a.Estado,
        FechaSalida = a.FechaSalida,
        Observaciones = a.Observaciones,
        IdAutor = a.IdAutor,
        CreadoEn = a.CreadoEn,
        VersionRegistro = a.VersionRegistro,
        EliminadoEn = a.EliminadoEn
    };
}
