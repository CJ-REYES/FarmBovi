using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/animales")]
public sealed class AnimalsController(FarmDbContext db) : ControllerBase
{
    [HttpGet] public Task<List<Animal>> GetAll(CancellationToken ct) => db.Animales.AsNoTracking().ToListAsync(ct);
    [HttpGet("{id:int}")] public async Task<ActionResult<Animal>> Get(int id, CancellationToken ct) => await db.Animales.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();
    [HttpPost] public async Task<ActionResult<Animal>> Create(Animal item, CancellationToken ct)
    {
        item.IdAnimal = 0; item.FechaCreacion = DateTime.UtcNow; item.VersionRegistro = 1;
        db.Animales.Add(item);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("El arete ya existe en este rancho o las referencias no son válidas."); }
        return CreatedAtAction(nameof(Get), new { id = item.IdAnimal }, item);
    }
    [HttpPut("{id:int}")] public async Task<IActionResult> Update(int id, Animal input, CancellationToken ct)
    {
        var item = await db.Animales.FindAsync([id], ct); if (item is null) return NotFound();
        item.IdRancho = input.IdRancho; item.IdLote = input.IdLote; item.Arete = input.Arete; item.Raza = input.Raza; item.Sexo = input.Sexo;
        item.FechaNacimiento = input.FechaNacimiento; item.FechaIngreso = input.FechaIngreso; item.Procedencia = input.Procedencia; item.Estado = input.Estado;
        item.FechaSalida = input.FechaSalida; item.Observaciones = input.Observaciones; item.IdAutor = input.IdAutor; item.EliminadoEn = input.EliminadoEn; item.VersionRegistro++;
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("El arete ya existe en este rancho o las referencias no son válidas."); }
        return NoContent();
    }
    [HttpDelete("{id:int}")] public async Task<IActionResult> Delete(int id, CancellationToken ct)
    { var item = await db.Animales.FindAsync([id], ct); if (item is null) return NotFound(); db.Animales.Remove(item); try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { return Conflict("No se pudo eliminar el animal por una restricción de datos."); } return NoContent(); }
}
