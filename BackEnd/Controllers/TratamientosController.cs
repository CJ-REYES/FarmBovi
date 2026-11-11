using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/tratamientos")]
[Produces("application/json")]
public sealed class TratamientosController(FarmDbContext database) : ControllerBase
{
    private const string DefaultAutorId = "00000000-0000-0000-0000-000000000001";

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TratamientoResponse>>> GetAll(
        [FromQuery] string? idEventoSanitario,
        [FromQuery] string? idAnimal,
        CancellationToken cancellationToken)
    {
        var query = database.Tratamientos
            .AsNoTracking()
            .Include(t => t.EventoSanitario)
            .Where(t => t.EliminadoEn == null && t.EventoSanitario != null && t.EventoSanitario.EliminadoEn == null);

        if (!string.IsNullOrWhiteSpace(idEventoSanitario))
        {
            var trimmed = idEventoSanitario.Trim();
            query = query.Where(t => t.IdEventoSanitario == trimmed);
        }

        if (!string.IsNullOrWhiteSpace(idAnimal))
        {
            var trimmedAnimal = idAnimal.Trim();
            query = query.Where(t => t.EventoSanitario!.IdAnimal == trimmedAnimal);
        }

        var tratamientos = await query
            .OrderByDescending(t => t.FechaInicio)
            .ThenByDescending(t => t.CreadoEn)
            .ToListAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var result = tratamientos
            .Select(t =>
            {
                var animalId = t.EventoSanitario?.IdAnimal ?? string.Empty;
                var cattle = EventosSanitariosController.FindCattle(cattleList, animalId);
                return TratamientoResponse.From(t, animalId, cattle);
            })
            .ToList();

        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<TratamientoResponse>> GetById(string id, CancellationToken cancellationToken)
    {
        var tratamiento = await database.Tratamientos
            .AsNoTracking()
            .Include(t => t.EventoSanitario)
            .SingleOrDefaultAsync(t => t.IdTratamiento == id && t.EliminadoEn == null, cancellationToken);

        if (tratamiento is null || tratamiento.EventoSanitario is null) return NotFound();

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var cattle = EventosSanitariosController.FindCattle(cattleList, tratamiento.EventoSanitario.IdAnimal);
        return Ok(TratamientoResponse.From(tratamiento, tratamiento.EventoSanitario.IdAnimal, cattle));
    }

    [HttpPost]
    public async Task<ActionResult<TratamientoResponse>> Create(
        TratamientoRequest request,
        CancellationToken cancellationToken)
    {
        var evento = await database.EventosSanitarios
            .AsNoTracking()
            .SingleOrDefaultAsync(
                e => e.IdEventoSanitario == request.IdEventoSanitario.Trim() && e.EliminadoEn == null,
                cancellationToken);

        if (evento is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Evento sanitario no encontrado",
                detail: "El evento sanitario indicado no existe o fue eliminado.");
        }

        var tratamiento = new Tratamiento
        {
            IdTratamiento = Guid.NewGuid().ToString(),
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        Apply(request, tratamiento);
        database.Tratamientos.Add(tratamiento);
        await database.SaveChangesAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var cattle = EventosSanitariosController.FindCattle(cattleList, evento.IdAnimal);
        var response = TratamientoResponse.From(tratamiento, evento.IdAnimal, cattle);
        return CreatedAtAction(nameof(GetById), new { id = tratamiento.IdTratamiento }, response);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<TratamientoResponse>> Update(
        string id,
        TratamientoRequest request,
        CancellationToken cancellationToken)
    {
        var tratamiento = await database.Tratamientos
            .Include(t => t.EventoSanitario)
            .SingleOrDefaultAsync(t => t.IdTratamiento == id && t.EliminadoEn == null, cancellationToken);

        if (tratamiento is null) return NotFound();

        var evento = await database.EventosSanitarios
            .AsNoTracking()
            .SingleOrDefaultAsync(
                e => e.IdEventoSanitario == request.IdEventoSanitario.Trim() && e.EliminadoEn == null,
                cancellationToken);

        if (evento is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Evento sanitario no encontrado",
                detail: "El evento sanitario indicado no existe o fue eliminado.");
        }

        Apply(request, tratamiento);
        tratamiento.VersionRegistro += 1;
        await database.SaveChangesAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var cattle = EventosSanitariosController.FindCattle(cattleList, evento.IdAnimal);
        return Ok(TratamientoResponse.From(tratamiento, evento.IdAnimal, cattle));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var tratamiento = await database.Tratamientos
            .SingleOrDefaultAsync(t => t.IdTratamiento == id && t.EliminadoEn == null, cancellationToken);

        if (tratamiento is null) return NotFound();

        tratamiento.EliminadoEn = DateTime.UtcNow;
        tratamiento.VersionRegistro += 1;
        await database.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    private static void Apply(TratamientoRequest request, Tratamiento tratamiento)
    {
        tratamiento.IdEventoSanitario = request.IdEventoSanitario.Trim();
        tratamiento.Producto = request.Producto.Trim();
        tratamiento.Dosis = request.Dosis;
        tratamiento.UnidadDosis = request.UnidadDosis.Trim();
        tratamiento.ViaAdministracion = string.IsNullOrWhiteSpace(request.ViaAdministracion) ? null : request.ViaAdministracion.Trim();
        tratamiento.Frecuencia = request.Frecuencia.Trim();
        tratamiento.FechaInicio = request.FechaInicio;
        tratamiento.FechaFin = request.FechaFin;
        tratamiento.Responsable = request.Responsable.Trim();
        tratamiento.PrescripcionUri = string.IsNullOrWhiteSpace(request.PrescripcionUri) ? null : request.PrescripcionUri.Trim();
        tratamiento.Estado = request.Estado.Trim();
        tratamiento.IdAutor = string.IsNullOrWhiteSpace(request.IdAutor) ? DefaultAutorId : request.IdAutor.Trim();
    }
}
