using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace FarmBovi.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/animales")]
public sealed class AnimalsController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    public Task<List<Animal>> GetAll([FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Animales.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(a => a.EliminadoEn == null);

        return query.ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Animal>> Get(Guid id, CancellationToken ct) =>
        await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == id, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpPost]
    public async Task<ActionResult<Animal>> Create(Animal item, CancellationToken ct)
    {
        if (item.IdAnimal == Guid.Empty)
            item.IdAnimal = Guid.NewGuid();

        var existing = await db.Animales.AsNoTracking().FirstOrDefaultAsync(a => a.IdAnimal == item.IdAnimal, ct);
        if (existing is not null)
            return Ok(existing);

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, item.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        item.IdAutor = authorId;
        item.Arete = item.Arete.Trim();
        item.Raza = item.Raza.Trim();
        item.Sexo = item.Sexo.Trim();
        item.Procedencia = item.Procedencia.Trim();
        item.Estado = item.Estado.Trim();

        var validationError = await validator.ValidateAnimalAsync(item, excludeAnimalId: null, ct);
        if (validationError is not null) return BadRequest(validationError);

        if (item.CreadoEn == default) item.CreadoEn = DateTime.UtcNow;
        if (item.VersionRegistro <= 0) item.VersionRegistro = 1;
        if (item.FechaIngreso == default) item.FechaIngreso = DateTime.UtcNow.Date;

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
            CreadoEn = DateTime.UtcNow,
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
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, input.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        input.IdRancho = item.IdRancho; 
        input.Arete = input.Arete.Trim();
        var validationError = await validator.ValidateAnimalAsync(input, excludeAnimalId: id, ct);
        if (validationError is not null) return BadRequest(validationError);

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
            return Conflict("El arete ya existe en este rancho o las referencias no son válidas.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Animales.FindAsync([id], ct);
        if (item is null) return NotFound();

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }
}