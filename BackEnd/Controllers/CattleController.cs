using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/cattle")]
[Produces("application/json")]
public sealed class CattleController(FarmDbContext database) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CattleResponse>>> GetAll(CancellationToken cancellationToken)
    {
        return Ok(await database.Cattle.AsNoTracking()
            .OrderBy(animal => animal.EarTag)
            .Select(CattleResponse.Projection)
            .ToListAsync(cancellationToken));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<CattleResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        var animal = await database.Cattle.AsNoTracking()
            .Where(animal => animal.Id == id)
            .Select(CattleResponse.Projection)
            .SingleOrDefaultAsync(cancellationToken);

        return animal is null ? NotFound() : Ok(animal);
    }

    [HttpPost]
    public async Task<ActionResult<CattleResponse>> Create(CattleRequest request, CancellationToken cancellationToken)
    {
        var animal = new Cattle();
        Apply(request, animal);
        database.Cattle.Add(animal);

        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsDuplicateEarTag(exception))
        {
            return DuplicateEarTag();
        }

        return CreatedAtAction(nameof(GetById), new { id = animal.Id }, CattleResponse.From(animal));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<CattleResponse>> Update(int id, CattleRequest request, CancellationToken cancellationToken)
    {
        var animal = await database.Cattle.SingleOrDefaultAsync(value => value.Id == id, cancellationToken);
        if (animal is null) return NotFound();

        Apply(request, animal);
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsDuplicateEarTag(exception))
        {
            return DuplicateEarTag();
        }
        catch (DbUpdateConcurrencyException)
        {
            return NotFound();
        }

        return Ok(CattleResponse.From(animal));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var animal = await database.Cattle.SingleOrDefaultAsync(value => value.Id == id, cancellationToken);
        if (animal is null) return NotFound();

        database.Cattle.Remove(animal);
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return NotFound();
        }
        return NoContent();
    }

    private static void Apply(CattleRequest request, Cattle animal)
    {
        animal.EarTag = request.EarTag.Trim().ToUpperInvariant();
        animal.Name = request.Name.Trim();
        animal.Breed = request.Breed.Trim();
        animal.Sex = request.Sex;
        animal.BirthDate = request.BirthDate;
    }

    private static bool IsDuplicateEarTag(DbUpdateException exception) =>
        exception.InnerException is SqliteException { SqliteExtendedErrorCode: 2067 };

    private ObjectResult DuplicateEarTag() => Problem(
        statusCode: StatusCodes.Status409Conflict,
        title: "Arete duplicado",
        detail: "Ya existe un bovino con este arete. Usa un identificador diferente.");
}
