using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.Animal)]
[Route("api/animales")]
public sealed class AnimalsController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<AnimalResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<AnimalResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Animales.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => ranchIds.Contains(x.IdRancho));

        var items = await query.Select(a => ToResponseDto(a)).ToListAsync(ct);
        return Ok(items);
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
        [FromServices] RanchAccessService access, AnimalCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdAnimal ?? Guid.NewGuid();

        var existing = await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == id, ct);
        if (existing is not null)
        {
            return MatchesAnimal(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un animal con el identificador proporcionado y contenido diferente.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var item = new Animal
        {
            IdAnimal = id,
            IdRancho = dto.IdRancho,
            IdLote = dto.IdLote,
            Arete = dto.Arete.Trim(),
            Raza = dto.Raza.Trim(),
            Sexo = dto.Sexo.Trim(),
            FechaNacimiento = ApiProblemResults.EnsureUtc(dto.FechaNacimiento),
            FechaIngreso = ApiProblemResults.EnsureUtc(dto.FechaIngreso),
            Procedencia = dto.Procedencia.Trim(),
            Estado = dto.Estado.Trim(),
            FechaSalida = ApiProblemResults.EnsureUtc(dto.FechaSalida),
            Observaciones = dto.Observaciones?.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var validationError = await validator.ValidateAnimalAsync(item, excludeAnimalId: null, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Animales.Add(item);

        // Regla 06: El alta inicial debe quedar registrada en el historial de movimientos.
        var altaMovimiento = new MovimientoAnimal
        {
            IdMovimiento = Guid.NewGuid(),
            IdAnimal = item.IdAnimal,
            IdLoteOrigen = null,
            IdLoteDestino = item.IdLote,
            Tipo = "Alta",
            Fecha = item.FechaIngreso,
            OrigenExterno = item.Procedencia,
            Motivo = "Alta inicial de expediente",
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };
        db.MovimientosAnimales.Add(altaMovimiento);

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception ex) when (ex is DbUpdateException or InvalidOperationException or ArgumentException)
        {
            await tx.RollbackAsync(ct);

            var collision = await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == id, ct);
            if (collision is not null)
            {
                var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
                if (ranchIds.Contains(collision.IdRancho))
                {
                    return MatchesAnimal(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un animal con el identificador proporcionado y contenido diferente.");
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
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El animal solicitado no existe.");

        if (dto.IdRancho.HasValue && dto.IdRancho.Value != item.IdRancho)
        {
            return this.ValidationError("No se permite transferir un animal a otro rancho mediante actualización directa; use el flujo de movimientos.", nameof(dto.IdRancho));
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var candidate = new Animal
        {
            IdAnimal = item.IdAnimal,
            IdRancho = item.IdRancho,
            IdLote = dto.IdLote,
            Arete = dto.Arete.Trim(),
            Raza = dto.Raza.Trim(),
            Sexo = dto.Sexo.Trim(),
            FechaNacimiento = ApiProblemResults.EnsureUtc(dto.FechaNacimiento),
            FechaIngreso = ApiProblemResults.EnsureUtc(dto.FechaIngreso),
            Procedencia = dto.Procedencia.Trim(),
            Estado = dto.Estado.Trim(),
            FechaSalida = ApiProblemResults.EnsureUtc(dto.FechaSalida),
            Observaciones = dto.Observaciones?.Trim(),
            IdAutor = authorId,
            EliminadoEn = ApiProblemResults.EnsureUtc(dto.EliminadoEn)
        };
        var validationError = await validator.ValidateAnimalAsync(candidate, excludeAnimalId: id, ct);
        if (validationError is not null) return this.ValidationError(validationError);

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
        item.EliminadoEn = candidate.EliminadoEn;
        item.VersionRegistro++;

        // Regla 06 y 08: Registrar cambio de lote o salida en MovimientoAnimal sin perder historial.
        if (loteAnterior != item.IdLote)
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
                CreadoEn = DateTime.UtcNow,
                VersionRegistro = 1
            });
        }
        else if (!string.Equals(estadoAnterior, item.Estado, StringComparison.OrdinalIgnoreCase) &&
                 (item.Estado.Equals("Vendido", StringComparison.OrdinalIgnoreCase) ||
                  item.Estado.Equals("Venta", StringComparison.OrdinalIgnoreCase) ||
                  item.Estado.Equals("Baja", StringComparison.OrdinalIgnoreCase)))
        {
            item.FechaSalida ??= DateTime.UtcNow.Date;
            db.MovimientosAnimales.Add(new MovimientoAnimal
            {
                IdMovimiento = Guid.NewGuid(),
                IdAnimal = item.IdAnimal,
                IdLoteOrigen = item.IdLote,
                IdLoteDestino = null,
                Tipo = item.Estado.StartsWith("Ven", StringComparison.OrdinalIgnoreCase) ? "Venta" : "Baja",
                Fecha = item.FechaSalida.Value,
                Motivo = "Salida registrada en expediente",
                IdAutor = authorId,
                CreadoEn = DateTime.UtcNow,
                VersionRegistro = 1
            });
        }

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return this.ConflictProblem("El arete ya existe en este rancho o las referencias no son válidas.");
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
        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El animal solicitado no existe.");

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
        ApiProblemResults.SameUtcInstant(existing.FechaNacimiento, dto.FechaNacimiento) &&
        ApiProblemResults.SameUtcInstant(existing.FechaIngreso, dto.FechaIngreso) &&
        ApiProblemResults.SameText(existing.Procedencia, dto.Procedencia) &&
        ApiProblemResults.SameText(existing.Estado, dto.Estado) &&
        ApiProblemResults.SameUtcInstant(existing.FechaSalida, dto.FechaSalida) &&
        ApiProblemResults.SameText(existing.Observaciones, dto.Observaciones);

    private static AnimalResponseDto ToResponseDto(Animal a) => new()
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
