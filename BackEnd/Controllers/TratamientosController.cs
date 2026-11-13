using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/tratamientos")]
public sealed class TratamientosController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
<<<<<<< HEAD
    public async Task<ActionResult<List<Tratamiento>>> GetAll([FromQuery] int? idRancho, CancellationToken ct)
    {
        var query = db.Tratamientos
            .AsNoTracking()
            .Where(t => t.EliminadoEn == null);

        if (idRancho.HasValue)
        {
            int r = idRancho.Value;
            query = query.Where(t => db.Animales.Any(an => an.IdAnimal.ToString() == t.IdAnimal.ToString() && an.IdRancho == r));
        }

        var lista = await query.ToListAsync(ct);
        return Ok(lista);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Tratamiento>> Get(int id, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        return item is not null ? Ok(item) : NotFound();
    }
=======
    public Task<List<Tratamiento>> GetAll(CancellationToken ct) =>
        db.Tratamientos.AsNoTracking().ToListAsync(ct);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Tratamiento>> Get(int id, CancellationToken ct) =>
        await db.Tratamientos.FindAsync([id], ct) is { } item ? Ok(item) : NotFound();
>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676

    [HttpPost]
    public async Task<ActionResult<Tratamiento>> Create(Tratamiento item, CancellationToken ct)
    {
<<<<<<< HEAD
        item.IdTratamiento = 0;
        item.FechaCreacion = DateTime.UtcNow;

        db.Tratamientos.Add(item);

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo registrar el tratamiento, verifique la referencia del animal."); 
=======
        if (item.Dosis <= 0)
            return BadRequest("La dosis del tratamiento debe ser mayor que cero.");
        if (item.FechaFin.HasValue && item.FechaFin.Value < item.FechaInicio)
            return BadRequest("La fecha de fin no puede ser anterior a la fecha de inicio.");

        item.IdTratamiento = 0;
        item.CreadoEn = DateTime.UtcNow;
        item.VersionRegistro = 1;
        if (item.FechaInicio == default) item.FechaInicio = DateTime.UtcNow;

        db.Tratamientos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el tratamiento; verifica que el evento sanitario exista.");
>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdTratamiento }, item);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, Tratamiento input, CancellationToken ct)
    {
<<<<<<< HEAD
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdAnimal = input.IdAnimal;
        item.Tipo = input.Tipo;
        item.Medicamento = input.Medicamento;
        item.Dosis = input.Dosis;
        item.Fecha = input.Fecha;
        item.Observaciones = input.Observaciones;
        item.IdAutor = input.IdAutor;

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo actualizar el registro de tratamiento."); 
=======
        if (input.Dosis <= 0)
            return BadRequest("La dosis del tratamiento debe ser mayor que cero.");
        if (input.FechaFin.HasValue && input.FechaFin.Value < input.FechaInicio)
            return BadRequest("La fecha de fin no puede ser anterior a la fecha de inicio.");

        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdEventoSanitario = input.IdEventoSanitario;
        item.Producto = input.Producto;
        item.Dosis = input.Dosis;
        item.UnidadDosis = input.UnidadDosis;
        item.ViaAdministracion = input.ViaAdministracion;
        item.Frecuencia = input.Frecuencia;
        item.FechaInicio = input.FechaInicio;
        item.FechaFin = input.FechaFin;
        item.Responsable = input.Responsable;
        item.PrescripcionUri = input.PrescripcionUri;
        item.Estado = input.Estado;
        item.IdAutor = input.IdAutor;
        item.EliminadoEn = input.EliminadoEn;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar el tratamiento; verifica las referencias.");
>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676
        }

        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var item = await db.Tratamientos.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.Tratamientos.Remove(item);
<<<<<<< HEAD

        try 
        { 
            await db.SaveChangesAsync(ct); 
        } 
        catch (DbUpdateException) 
        { 
            return Conflict("No se pudo eliminar el tratamiento debido a restricciones de datos."); 
=======
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se puede eliminar un tratamiento que tiene recordatorios asociados.");
>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676
        }

        return NoContent();
    }
<<<<<<< HEAD
}
=======
}
>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676
