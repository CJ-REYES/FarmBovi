using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/movimientos-animales")]
[RanchScope(RanchResource.MovimientoAnimal)]
public sealed class MovimientoAnimalController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<MovimientoAnimalResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<MovimientoAnimalResponseDto>>> GetAll(
        [FromServices] RanchAccessService access,
        [FromQuery] Guid? idRancho = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var query = db.MovimientosAnimales.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null);

        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = idRancho is { } targetRanch && targetRanch != Guid.Empty
            ? query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && a.IdRancho == targetRanch))
            : query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho)));

        var items = await query.OrderBy(m => m.Fecha).ToListAsync(ct);
        return Ok(items.Select(ToResponseDto).ToList());
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
        [FromServices] RanchAccessService access,
        MovimientoAnimalCreateDto dto,
        CancellationToken ct)
    {
        var id = dto.IdMovimiento ?? Guid.NewGuid();

        var existing = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (existing is not null)
        {
            return existing.EliminadoEn is null && MatchesMovimiento(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe un movimiento con el identificador proporcionado y contenido diferente o eliminado.");
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

        var (animal, validationError) = await validator.ValidateAndPrepareMovimientoAsync(movimiento, ct);
        if (validationError is not null || animal is null)
            return this.ValidationError(validationError ?? "No se pudo validar el movimiento.");

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        // Regla 06 y 08: Actualizar ubicación/estado del expediente atómicamente con el movimiento.
        var tipoNorm = movimiento.Tipo;
        if (movimiento.IdLoteDestino.HasValue &&
            (tipoNorm.Equals("Alta", StringComparison.OrdinalIgnoreCase) ||
             tipoNorm.Equals("CambioInterno", StringComparison.OrdinalIgnoreCase) ||
             tipoNorm.Equals("Cambio interno", StringComparison.OrdinalIgnoreCase)))
        {
            animal.IdLote = movimiento.IdLoteDestino;
            animal.VersionRegistro++;
        }
        else if (tipoNorm.Equals("Venta", StringComparison.OrdinalIgnoreCase) ||
                 tipoNorm.Equals("Baja", StringComparison.OrdinalIgnoreCase))
        {
            animal.IdLote = null;
            animal.Estado = tipoNorm.Equals("Venta", StringComparison.OrdinalIgnoreCase) ? "Vendido" : "Baja";
            animal.FechaSalida = ApiProblemResults.EnsureUtcDate(movimiento.Fecha);
            animal.VersionRegistro++;
        }

        db.MovimientosAnimales.Add(movimiento);

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);

            var collision = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User);
                var collisionRanch = await access.RanchOfAnimalAsync(collision.IdAnimal, ct);
                if (userId is { } uid && collisionRanch is { } ranchId &&
                    await access.CanAccessAsync(uid, ranchId, ct))
                {
                    return collision.EliminadoEn is null && MatchesMovimiento(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe un movimiento con el identificador proporcionado y contenido diferente o eliminado.");
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
        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return this.NotFoundProblem("El movimiento de animal solicitado no existe.");

        if (item.EliminadoEn is not null)
            return this.ConflictProblem("No se puede actualizar un movimiento eliminado.");

        if (dto.EliminadoEn.HasValue)
            return this.ValidationError("Para eliminar un movimiento utiliza el endpoint DELETE.", nameof(dto.EliminadoEn));

        if (dto.IdAnimal != item.IdAnimal)
            return this.ValidationError("No se permite cambiar el animal asociado a un movimiento.", nameof(dto.IdAnimal));

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor ?? Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError, nameof(dto.IdAutor));

        var candidate = new MovimientoAnimal
        {
            IdMovimiento = item.IdMovimiento,
            IdAnimal = item.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo.Trim(),
            Fecha = ApiProblemResults.EnsureUtc(dto.Fecha),
            OrigenExterno = dto.OrigenExterno?.Trim(),
            DestinoExterno = dto.DestinoExterno?.Trim(),
            Motivo = dto.Motivo?.Trim(),
            IdAutor = authorId
        };
        var (_, validationError) = await validator.ValidateAndPrepareMovimientoAsync(candidate, ct);
        if (validationError is not null) return this.ValidationError(validationError);

        item.IdLoteOrigen = candidate.IdLoteOrigen;
        item.IdLoteDestino = candidate.IdLoteDestino;
        item.Tipo = candidate.Tipo;
        item.Fecha = candidate.Fecha;
        item.OrigenExterno = candidate.OrigenExterno;
        item.DestinoExterno = candidate.DestinoExterno;
        item.Motivo = candidate.Motivo;
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
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

    /// <summary>
    /// Traslada un animal individual de su rancho actual hacia otro rancho autorizado,
    /// actualizando su expediente y registrando la trazabilidad de forma atómica.
    /// </summary>
    [HttpPost("traslado-rancho/animal")]
    [ProducesResponseType(typeof(TrasladoRanchoResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TrasladoRanchoResultDto>> TrasladarAnimalEntreRanchos(
        [FromServices] RanchAccessService access,
        TrasladoAnimalRanchoDto dto,
        CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return this.UnauthorizedProblem();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError);

        var animal = await db.Animales.FirstOrDefaultAsync(
            a => a.IdAnimal == dto.IdAnimal && a.EliminadoEn == null, ct);
        if (animal is null)
            return this.NotFoundProblem("El animal seleccionado no existe o está desactivado.");

        if (animal.Estado.Equals("Vendido", StringComparison.OrdinalIgnoreCase) ||
            animal.Estado.Equals("Baja", StringComparison.OrdinalIgnoreCase))
        {
            return this.ValidationError($"No se puede trasladar un animal con estado '{animal.Estado}'.", nameof(dto.IdAnimal));
        }

        if (animal.IdRancho == dto.IdRanchoDestino)
            return this.ValidationError("El rancho de destino debe ser distinto al rancho actual del animal.", nameof(dto.IdRanchoDestino));

        var ranchoOrigen = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == animal.IdRancho && r.EliminadoEn == null, ct);
        var ranchoDestino = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == dto.IdRanchoDestino && r.EliminadoEn == null, ct);
        if (ranchoOrigen is null || ranchoDestino is null)
            return this.NotFoundProblem("El rancho de origen o destino no existe o fue eliminado.");

        if (!await access.CanAccessAsync(userId.Value, ranchoOrigen.IdRancho, ct) ||
            !await access.CanAccessAsync(userId.Value, ranchoDestino.IdRancho, ct))
        {
            return this.ForbiddenProblem("Necesitas membresía activa tanto en el rancho de origen como en el rancho de destino.");
        }

        if (dto.IdLoteDestino.HasValue)
        {
            var loteDestino = await db.Lotes.AsNoTracking()
                .FirstOrDefaultAsync(l => l.IdLote == dto.IdLoteDestino.Value && l.EliminadoEn == null, ct);
            if (loteDestino is null || loteDestino.IdRancho != ranchoDestino.IdRancho)
            {
                return this.ValidationError(
                    "El potrero/lote de destino no existe o no pertenece al rancho de destino.",
                    nameof(dto.IdLoteDestino));
            }
        }

        var normalizedArete = animal.Arete.Trim();
        var duplicateArete = await db.Animales.AsNoTracking().AnyAsync(
            a => a.IdRancho == ranchoDestino.IdRancho &&
                 a.IdAnimal != animal.IdAnimal &&
                 a.Arete.ToLower() == normalizedArete.ToLower(),
            ct);
        if (duplicateArete)
        {
            return this.ConflictProblem(
                $"Ya existe un bovino con el arete '{normalizedArete}' en el rancho destino '{ranchoDestino.Nombre}'.");
        }

        var ahora = DateTime.UtcNow;
        var fecha = dto.Fecha.HasValue ? ApiProblemResults.EnsureUtc(dto.Fecha.Value) : ahora;
        var loteOrigenId = animal.IdLote;

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        animal.IdRancho = ranchoDestino.IdRancho;
        animal.IdLote = dto.IdLoteDestino;
        animal.IdAutor = authorId;
        animal.VersionRegistro++;

        var recordatoriosAnimal = await db.Recordatorios
            .Where(r => r.IdAnimal == animal.IdAnimal && r.EliminadoEn == null && r.IdRancho == ranchoOrigen.IdRancho)
            .ToListAsync(ct);
        foreach (var rec in recordatoriosAnimal)
        {
            rec.IdRancho = ranchoDestino.IdRancho;
            rec.VersionRegistro++;
        }

        var archivosAnimal = await db.ArchivosMultimedia
            .Where(m => m.IdAnimal == animal.IdAnimal && m.EliminadoEn == null && m.IdRancho == ranchoOrigen.IdRancho)
            .ToListAsync(ct);
        foreach (var arch in archivosAnimal)
        {
            arch.IdRancho = ranchoDestino.IdRancho;
            arch.VersionRegistro++;
        }

        var motivo = string.IsNullOrWhiteSpace(dto.Motivo)
            ? $"Traslado de rancho: {ranchoOrigen.Nombre} → {ranchoDestino.Nombre}"
            : dto.Motivo.Trim();

        var movimiento = new MovimientoAnimal
        {
            IdMovimiento = Guid.NewGuid(),
            IdAnimal = animal.IdAnimal,
            IdLoteOrigen = loteOrigenId,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = "Traslado",
            Fecha = fecha,
            OrigenExterno = $"Rancho: {ranchoOrigen.Nombre}",
            DestinoExterno = $"Rancho: {ranchoDestino.Nombre}",
            Motivo = motivo,
            IdAutor = authorId,
            CreadoEn = ahora,
            VersionRegistro = 1
        };

        db.MovimientosAnimales.Add(movimiento);

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return this.ConflictProblem(
                "No se pudo completar el traslado del animal por una restricción de integridad (verifica arete o lote en destino).");
        }

        return Ok(new TrasladoRanchoResultDto(
            Modo: "Animal",
            RanchoOrigenId: ranchoOrigen.IdRancho,
            RanchoOrigenNombre: ranchoOrigen.Nombre,
            RanchoDestinoId: ranchoDestino.IdRancho,
            RanchoDestinoNombre: ranchoDestino.Nombre,
            AnimalesTrasladados: 1,
            LoteTrasladado: null,
            Animales: [AnimalsController.ToResponseDto(animal)],
            Movimientos: [ToResponseDto(movimiento)],
            Mensaje: $"Bovino '{animal.Arete}' trasladado de '{ranchoOrigen.Nombre}' a '{ranchoDestino.Nombre}'."));
    }

    /// <summary>
    /// Traslada un lote completo (junto con sus animales activos) o reubica todos los animales
    /// de un lote hacia otro rancho autorizado, generando los registros de trazabilidad atómicamente.
    /// </summary>
    [HttpPost("traslado-rancho/lote")]
    [ProducesResponseType(typeof(TrasladoRanchoResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TrasladoRanchoResultDto>> TrasladarLoteEntreRanchos(
        [FromServices] RanchAccessService access,
        TrasladoLoteRanchoDto dto,
        CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return this.UnauthorizedProblem();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return this.ValidationError(authorError);

        var modoNormalizado = string.Equals(dto.ModoLote?.Trim(), "ReubicarAnimalesEnLoteDestino", StringComparison.OrdinalIgnoreCase)
            ? "ReubicarAnimalesEnLoteDestino"
            : "MoverLoteCompleto";

        var lote = await db.Lotes.FirstOrDefaultAsync(
            l => l.IdLote == dto.IdLote && l.EliminadoEn == null, ct);
        if (lote is null)
            return this.NotFoundProblem("El lote seleccionado no existe o está desactivado.");

        if (lote.IdRancho == dto.IdRanchoDestino)
            return this.ValidationError("El rancho de destino debe ser distinto al rancho actual del lote.", nameof(dto.IdRanchoDestino));

        var ranchoOrigen = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == lote.IdRancho && r.EliminadoEn == null, ct);
        var ranchoDestino = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == dto.IdRanchoDestino && r.EliminadoEn == null, ct);
        if (ranchoOrigen is null || ranchoDestino is null)
            return this.NotFoundProblem("El rancho de origen o destino no existe o fue eliminado.");

        if (!await access.CanAccessAsync(userId.Value, ranchoOrigen.IdRancho, ct) ||
            !await access.CanAccessAsync(userId.Value, ranchoDestino.IdRancho, ct))
        {
            return this.ForbiddenProblem("Necesitas membresía activa tanto en el rancho de origen como en el rancho de destino.");
        }

        var animalesEnLote = await db.Animales
            .Where(a => a.IdLote == lote.IdLote && a.EliminadoEn == null)
            .ToListAsync(ct);

        if (modoNormalizado == "MoverLoteCompleto")
        {
            var normalizedLotName = lote.Nombre.Trim();
            var dupLotName = await db.Lotes.AsNoTracking().AnyAsync(
                l => l.IdRancho == ranchoDestino.IdRancho &&
                     l.IdLote != lote.IdLote &&
                     l.Nombre.ToLower() == normalizedLotName.ToLower(),
                ct);
            if (dupLotName)
            {
                return this.ConflictProblem(
                    $"Ya existe un lote llamado '{normalizedLotName}' en el rancho destino '{ranchoDestino.Nombre}'.");
            }
        }
        else
        {
            if (animalesEnLote.Count == 0)
            {
                return this.ValidationError(
                    "El lote seleccionado no tiene animales activos para reubicar en el rancho destino.",
                    nameof(dto.IdLote));
            }

            if (dto.IdLoteDestino.HasValue)
            {
                var loteDestino = await db.Lotes.AsNoTracking()
                    .FirstOrDefaultAsync(l => l.IdLote == dto.IdLoteDestino.Value && l.EliminadoEn == null, ct);
                if (loteDestino is null || loteDestino.IdRancho != ranchoDestino.IdRancho)
                {
                    return this.ValidationError(
                        "El lote de destino no existe o no pertenece al rancho de destino.",
                        nameof(dto.IdLoteDestino));
                }
            }
        }

        if (animalesEnLote.Count > 0)
        {
            var aretesLower = animalesEnLote
                .Select(a => a.Arete.Trim().ToLowerInvariant())
                .Distinct()
                .ToList();
            var animalIds = animalesEnLote.Select(a => a.IdAnimal).ToHashSet();

            var colisiones = await db.Animales.AsNoTracking()
                .Where(a => a.IdRancho == ranchoDestino.IdRancho &&
                            aretesLower.Contains(a.Arete.ToLower()))
                .Select(a => new { a.IdAnimal, a.Arete })
                .ToListAsync(ct);
            var aretesDuplicados = colisiones
                .Where(c => !animalIds.Contains(c.IdAnimal))
                .Select(c => c.Arete)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (aretesDuplicados.Count > 0)
            {
                return this.ConflictProblem(
                    $"No se puede trasladar el lote porque los siguientes aretes ya existen en '{ranchoDestino.Nombre}': {string.Join(", ", aretesDuplicados)}.");
            }
        }

        var ahora = DateTime.UtcNow;
        var fecha = dto.Fecha.HasValue ? ApiProblemResults.EnsureUtc(dto.Fecha.Value) : ahora;
        var targetLotId = modoNormalizado == "MoverLoteCompleto" ? lote.IdLote : dto.IdLoteDestino;

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        Lote? movedLot = null;
        if (modoNormalizado == "MoverLoteCompleto")
        {
            lote.IdRancho = ranchoDestino.IdRancho;
            lote.IdAutor = authorId;
            lote.VersionRegistro++;
            movedLot = lote;

            var recordatoriosLote = await db.Recordatorios
                .Where(r => r.IdLote == lote.IdLote && r.EliminadoEn == null && r.IdRancho == ranchoOrigen.IdRancho)
                .ToListAsync(ct);
            foreach (var rec in recordatoriosLote)
            {
                rec.IdRancho = ranchoDestino.IdRancho;
                rec.VersionRegistro++;
            }
        }

        var animalIdList = animalesEnLote.Select(a => a.IdAnimal).ToList();
        if (animalIdList.Count > 0)
        {
            var recordatoriosAnimales = await db.Recordatorios
                .Where(r => r.IdAnimal != null && animalIdList.Contains(r.IdAnimal.Value) &&
                            r.EliminadoEn == null && r.IdRancho == ranchoOrigen.IdRancho)
                .ToListAsync(ct);
            foreach (var rec in recordatoriosAnimales)
            {
                rec.IdRancho = ranchoDestino.IdRancho;
                rec.VersionRegistro++;
            }

            var archivosAnimales = await db.ArchivosMultimedia
                .Where(m => m.IdAnimal != null && animalIdList.Contains(m.IdAnimal.Value) &&
                            m.EliminadoEn == null && m.IdRancho == ranchoOrigen.IdRancho)
                .ToListAsync(ct);
            foreach (var arch in archivosAnimales)
            {
                arch.IdRancho = ranchoDestino.IdRancho;
                arch.VersionRegistro++;
            }
        }

        var motivoBase = string.IsNullOrWhiteSpace(dto.Motivo)
            ? (modoNormalizado == "MoverLoteCompleto"
                ? $"Traslado de lote '{lote.Nombre}': {ranchoOrigen.Nombre} → {ranchoDestino.Nombre}"
                : $"Traslado de animales del lote '{lote.Nombre}': {ranchoOrigen.Nombre} → {ranchoDestino.Nombre}")
            : dto.Motivo.Trim();

        var movimientosCreados = new List<MovimientoAnimal>(animalesEnLote.Count);
        foreach (var animal in animalesEnLote)
        {
            animal.IdRancho = ranchoDestino.IdRancho;
            animal.IdLote = targetLotId;
            animal.IdAutor = authorId;
            animal.VersionRegistro++;

            var mov = new MovimientoAnimal
            {
                IdMovimiento = Guid.NewGuid(),
                IdAnimal = animal.IdAnimal,
                IdLoteOrigen = lote.IdLote,
                IdLoteDestino = targetLotId,
                Tipo = "Traslado",
                Fecha = fecha,
                OrigenExterno = $"Rancho: {ranchoOrigen.Nombre}",
                DestinoExterno = $"Rancho: {ranchoDestino.Nombre}",
                Motivo = motivoBase,
                IdAutor = authorId,
                CreadoEn = ahora,
                VersionRegistro = 1
            };
            db.MovimientosAnimales.Add(mov);
            movimientosCreados.Add(mov);
        }

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return this.ConflictProblem(
                "No se pudo completar el traslado del lote por una restricción de unicidad o referencia en el rancho destino.");
        }

        var resumen = modoNormalizado == "MoverLoteCompleto"
            ? $"Lote '{lote.Nombre}' ({animalesEnLote.Count} bovino(s)) trasladado de '{ranchoOrigen.Nombre}' a '{ranchoDestino.Nombre}'."
            : $"{animalesEnLote.Count} bovino(s) del lote '{lote.Nombre}' trasladados de '{ranchoOrigen.Nombre}' a '{ranchoDestino.Nombre}'.";

        return Ok(new TrasladoRanchoResultDto(
            Modo: modoNormalizado,
            RanchoOrigenId: ranchoOrigen.IdRancho,
            RanchoOrigenNombre: ranchoOrigen.Nombre,
            RanchoDestinoId: ranchoDestino.IdRancho,
            RanchoDestinoNombre: ranchoDestino.Nombre,
            AnimalesTrasladados: animalesEnLote.Count,
            LoteTrasladado: movedLot is null ? null : LotesController.ToResponseDto(movedLot),
            Animales: animalesEnLote.Select(AnimalsController.ToResponseDto).ToList(),
            Movimientos: movimientosCreados.Select(ToResponseDto).ToList(),
            Mensaje: resumen));
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

    internal static MovimientoAnimalResponseDto ToResponseDto(MovimientoAnimal m) => new()
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
