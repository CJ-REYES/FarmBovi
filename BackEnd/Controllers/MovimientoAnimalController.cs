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
    public Task<List<MovimientoAnimal>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.MovimientosAnimales.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null);

        // Solo registros de ranchos donde el usuario tiene membresía activa.
        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => db.Animales.Any(a => a.IdAnimal == x.IdAnimal && ranchIds.Contains(a.IdRancho)));

        return query.OrderBy(m => m.Fecha).ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<MovimientoAnimal>> Get(Guid id, CancellationToken ct) =>
        await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<MovimientoAnimal>> Create(MovimientoAnimalCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdMovimiento is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(m => m.IdMovimiento == id, ct);
        if (existing is not null)
            return Ok(existing);

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var movimiento = new MovimientoAnimal
        {
            IdMovimiento = id,
            IdAnimal = dto.IdAnimal,
            IdLoteOrigen = dto.IdLoteOrigen,
            IdLoteDestino = dto.IdLoteDestino,
            Tipo = dto.Tipo.Trim(),
            Fecha = dto.Fecha == default ? DateTime.UtcNow : dto.Fecha,
            OrigenExterno = dto.OrigenExterno,
            DestinoExterno = dto.DestinoExterno,
            Motivo = dto.Motivo,
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        var (animal, validationError) = await validator.ValidateAndPrepareMovimientoAsync(movimiento, ct);
        if (validationError is not null || animal is null)
            return BadRequest(validationError);

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
            animal.Estado = tipoNorm.Equals("Venta", StringComparison.OrdinalIgnoreCase) ? "Vendido" : "Baja";
            animal.FechaSalida = movimiento.Fecha.Date;
            animal.VersionRegistro++;
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
            return Conflict("No se pudo registrar el movimiento; verifica las referencias.");
        }

        return CreatedAtAction(nameof(Get), new { id = movimiento.IdMovimiento }, movimiento);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, MovimientoAnimalUpdateDto dto, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        item.IdAnimal = dto.IdAnimal;
        item.IdLoteOrigen = dto.IdLoteOrigen;
        item.IdLoteDestino = dto.IdLoteDestino;
        item.Tipo = dto.Tipo.Trim();
        item.Fecha = dto.Fecha;
        item.OrigenExterno = dto.OrigenExterno;
        item.DestinoExterno = dto.DestinoExterno;
        item.Motivo = dto.Motivo;
        item.IdAutor = authorId;
        item.EliminadoEn = dto.EliminadoEn;
        item.VersionRegistro++;

        var (_, validationError) = await validator.ValidateAndPrepareMovimientoAsync(item, ct);
        if (validationError is not null) return BadRequest(validationError);

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("No se pudo actualizar el movimiento; verifica las referencias.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        // Regla 06 y 08: Conservar historial de movimientos mediante borrado lógico.
        var item = await db.MovimientosAnimales.FindAsync([id], ct);
        if (item is null) return NotFound();

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
    public async Task<ActionResult<TrasladoRanchoResultDto>> TrasladarAnimalEntreRanchos(
        [FromServices] RanchAccessService access,
        TrasladoAnimalRanchoDto dto,
        CancellationToken ct)
    {
        if (dto.IdAnimal == Guid.Empty || dto.IdRanchoDestino == Guid.Empty)
            return BadRequest(new { mensaje = "Debes especificar el animal y el rancho de destino." });

        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return BadRequest(new { mensaje = authorError });

        var animal = await db.Animales.FirstOrDefaultAsync(
            a => a.IdAnimal == dto.IdAnimal && a.EliminadoEn == null, ct);
        if (animal is null)
            return NotFound(new { mensaje = "El animal seleccionado no existe o está desactivado." });

        if (animal.Estado.Equals("Vendido", StringComparison.OrdinalIgnoreCase) ||
            animal.Estado.Equals("Baja", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new
            {
                mensaje = $"No se puede trasladar un animal con estado '{animal.Estado}'."
            });
        }

        if (animal.IdRancho == dto.IdRanchoDestino)
            return BadRequest(new { mensaje = "El rancho de destino debe ser distinto al rancho actual del animal." });

        var ranchoOrigen = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == animal.IdRancho && r.EliminadoEn == null, ct);
        var ranchoDestino = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == dto.IdRanchoDestino && r.EliminadoEn == null, ct);
        if (ranchoOrigen is null || ranchoDestino is null)
            return NotFound(new { mensaje = "El rancho de origen o destino no existe o fue eliminado." });

        if (!await access.CanAccessAsync(userId.Value, ranchoOrigen.IdRancho, ct) ||
            !await access.CanAccessAsync(userId.Value, ranchoDestino.IdRancho, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                mensaje = "Necesitas membresía activa tanto en el rancho de origen como en el rancho de destino."
            });
        }

        if (dto.IdLoteDestino.HasValue)
        {
            var loteDestino = await db.Lotes.AsNoTracking()
                .FirstOrDefaultAsync(l => l.IdLote == dto.IdLoteDestino.Value && l.EliminadoEn == null, ct);
            if (loteDestino is null || loteDestino.IdRancho != ranchoDestino.IdRancho)
            {
                return BadRequest(new
                {
                    mensaje = "El potrero/lote de destino no existe o no pertenece al rancho de destino."
                });
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
            return Conflict(new
            {
                mensaje = $"Ya existe un bovino con el arete '{normalizedArete}' en el rancho destino '{ranchoDestino.Nombre}'."
            });
        }

        var ahora = DateTime.UtcNow;
        var fecha = dto.Fecha is { } f && f != default ? f : ahora;
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
            return Conflict(new
            {
                mensaje = "No se pudo completar el traslado del animal por una restricción de integridad (verifica arete o lote en destino)."
            });
        }

        return Ok(new TrasladoRanchoResultDto(
            Modo: "Animal",
            RanchoOrigenId: ranchoOrigen.IdRancho,
            RanchoOrigenNombre: ranchoOrigen.Nombre,
            RanchoDestinoId: ranchoDestino.IdRancho,
            RanchoDestinoNombre: ranchoDestino.Nombre,
            AnimalesTrasladados: 1,
            LoteTrasladado: null,
            Animales: [animal],
            Movimientos: [movimiento],
            Mensaje: $"Bovino '{animal.Arete}' trasladado de '{ranchoOrigen.Nombre}' a '{ranchoDestino.Nombre}'."));
    }

    /// <summary>
    /// Traslada un lote completo (junto con sus animales activos) o reubica todos los animales
    /// de un lote hacia otro rancho autorizado, generando los registros de trazabilidad atómicamente.
    /// </summary>
    [HttpPost("traslado-rancho/lote")]
    public async Task<ActionResult<TrasladoRanchoResultDto>> TrasladarLoteEntreRanchos(
        [FromServices] RanchAccessService access,
        TrasladoLoteRanchoDto dto,
        CancellationToken ct)
    {
        if (dto.IdLote == Guid.Empty || dto.IdRanchoDestino == Guid.Empty)
            return BadRequest(new { mensaje = "Debes especificar el lote y el rancho de destino." });

        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return BadRequest(new { mensaje = authorError });

        var modoNormalizado = string.Equals(dto.ModoLote?.Trim(), "ReubicarAnimalesEnLoteDestino", StringComparison.OrdinalIgnoreCase)
            ? "ReubicarAnimalesEnLoteDestino"
            : "MoverLoteCompleto";

        var lote = await db.Lotes.FirstOrDefaultAsync(
            l => l.IdLote == dto.IdLote && l.EliminadoEn == null, ct);
        if (lote is null)
            return NotFound(new { mensaje = "El lote seleccionado no existe o está desactivado." });

        if (lote.IdRancho == dto.IdRanchoDestino)
            return BadRequest(new { mensaje = "El rancho de destino debe ser distinto al rancho actual del lote." });

        var ranchoOrigen = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == lote.IdRancho && r.EliminadoEn == null, ct);
        var ranchoDestino = await db.Ranchos.AsNoTracking()
            .FirstOrDefaultAsync(r => r.IdRancho == dto.IdRanchoDestino && r.EliminadoEn == null, ct);
        if (ranchoOrigen is null || ranchoDestino is null)
            return NotFound(new { mensaje = "El rancho de origen o destino no existe o fue eliminado." });

        if (!await access.CanAccessAsync(userId.Value, ranchoOrigen.IdRancho, ct) ||
            !await access.CanAccessAsync(userId.Value, ranchoDestino.IdRancho, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                mensaje = "Necesitas membresía activa tanto en el rancho de origen como en el rancho de destino."
            });
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
                return Conflict(new
                {
                    mensaje = $"Ya existe un lote llamado '{normalizedLotName}' en el rancho destino '{ranchoDestino.Nombre}'."
                });
            }
        }
        else
        {
            if (animalesEnLote.Count == 0)
            {
                return BadRequest(new
                {
                    mensaje = "El lote seleccionado no tiene animales activos para reubicar en el rancho destino."
                });
            }

            if (dto.IdLoteDestino.HasValue)
            {
                var loteDestino = await db.Lotes.AsNoTracking()
                    .FirstOrDefaultAsync(l => l.IdLote == dto.IdLoteDestino.Value && l.EliminadoEn == null, ct);
                if (loteDestino is null || loteDestino.IdRancho != ranchoDestino.IdRancho)
                {
                    return BadRequest(new
                    {
                        mensaje = "El lote de destino no existe o no pertenece al rancho de destino."
                    });
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
                return Conflict(new
                {
                    mensaje = $"No se puede trasladar el lote porque los siguientes aretes ya existen en '{ranchoDestino.Nombre}': {string.Join(", ", aretesDuplicados)}."
                });
            }
        }

        var ahora = DateTime.UtcNow;
        var fecha = dto.Fecha is { } f && f != default ? f : ahora;
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
            return Conflict(new
            {
                mensaje = "No se pudo completar el traslado del lote por una restricción de unicidad o referencia en el rancho destino."
            });
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
            LoteTrasladado: movedLot,
            Animales: animalesEnLote,
            Movimientos: movimientosCreados,
            Mensaje: resumen));
    }
}
