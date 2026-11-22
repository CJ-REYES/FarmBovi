using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/animales")]
public sealed class AnimalsController(
    FarmDbContext db,
    FarmDomainValidationService validator,
    RanchAccessService access) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<Animal>>> GetAll(
        [FromQuery] Guid? idRancho,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var ranchosAutorizadosIds = await access.ActiveRanchIds(userId.Value).Distinct().ToListAsync(ct);

        var query = db.Animales.AsNoTracking()
            .Where(a => ranchosAutorizadosIds.Contains(a.IdRancho));

        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        if (idRancho.HasValue && idRancho.Value != Guid.Empty)
        {
            if (!ranchosAutorizadosIds.Contains(idRancho.Value))
                return Forbid();

            query = query.Where(a => a.IdRancho == idRancho.Value);
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Animal>> Get(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == id, ct);
        if (item is null) return NotFound();

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        return Ok(item);
    }

    [HttpPost]
    public async Task<ActionResult<Animal>> Create(Animal item, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        if (item.IdRancho == Guid.Empty)
            return BadRequest("El campo idRancho es obligatorio.");

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return Forbid();

        if (item.IdAnimal == Guid.Empty)
            item.IdAnimal = Guid.NewGuid();

        var existing = await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == item.IdAnimal, ct);
        if (existing is not null)
            return Ok(existing);

        int authorId = userId.Value;
        item.IdAutor = authorId;

        item.Arete = item.Arete.Trim();
        item.Raza = item.Raza.Trim();
        item.Sexo = item.Sexo.Trim();
        item.Procedencia = item.Procedencia.Trim();
        item.Estado = item.Estado.Trim();

        var validationError = await validator.ValidateAnimalAsync(item, excludeAnimalId: null, ct);
        if (validationError is not null) return BadRequest(validationError);

        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;
        if (item.FechaIngreso == default) item.FechaIngreso = DateTime.UtcNow.Date;
        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Animales.Add(item);

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
            VersionRegistro = 1
        };
        db.MovimientosAnimales.Add(altaMovimiento);

        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(ct);
            return Conflict("El arete ya existe en este rancho o las referencias no son válidas.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdAnimal }, item);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Animal input, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.Animales.FindAsync([id], ct);
        if (item is null)
        {
            await tx.RollbackAsync(ct);
            return NotFound();
        }

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
        {
            await tx.RollbackAsync(ct);
            return Forbid();
        }

        int authorId = userId.Value;

        input.IdRancho = item.IdRancho;
        input.Arete = input.Arete.Trim();
        var validationError = await validator.ValidateAnimalAsync(input, excludeAnimalId: id, ct);
        if (validationError is not null)
        {
            await tx.RollbackAsync(ct);
            return BadRequest(validationError);
        }

        var loteAnterior = item.IdLote;
        var estadoAnterior = item.Estado;

        item.IdLote = input.IdLote;
        item.Arete = input.Arete;
        item.Raza = input.Raza.Trim();
        item.Sexo = input.Sexo.Trim();
        item.FechaNacimiento = input.FechaNacimiento;
        item.FechaIngreso = input.FechaIngreso;
        item.Procedencia = input.Procedencia.Trim();
        item.Estado = input.Estado.Trim();
        item.FechaSalida = input.FechaSalida;
        item.Observaciones = input.Observaciones;
        item.IdAutor = authorId;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

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
            return Conflict("El arete ya existe en este rancho o las referencias no son válidas.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return NotFound();

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
}
