using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/recordatorios")]
[Produces("application/json")]
public sealed class RecordatoriosController(FarmDbContext database) : ControllerBase
{
    private const string DefaultRanchoId = "00000000-0000-0000-0000-000000000100";
    private const string DefaultAutorId = "00000000-0000-0000-0000-000000000001";

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<RecordatorioResponse>>> GetAll(
        [FromQuery] string? estado,
        [FromQuery] string? idAnimal,
        CancellationToken cancellationToken)
    {
        var query = database.Recordatorios
            .AsNoTracking()
            .Include(r => r.Tratamiento)
            .Where(r => r.EliminadoEn == null);

        if (!string.IsNullOrWhiteSpace(estado))
        {
            var trimmedEstado = estado.Trim();
            query = query.Where(r => r.Estado == trimmedEstado);
        }

        if (!string.IsNullOrWhiteSpace(idAnimal))
        {
            var trimmedAnimal = idAnimal.Trim();
            query = query.Where(r => r.IdAnimal == trimmedAnimal);
        }

        var recordatorios = await query
            .OrderBy(r => r.Estado == "Completado" ? 1 : 0)
            .ThenBy(r => r.FechaProgramada)
            .ToListAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var result = recordatorios
            .Select(r => RecordatorioResponse.From(
                r,
                EventosSanitariosController.FindCattle(cattleList, r.IdAnimal),
                r.Tratamiento?.Producto))
            .ToList();

        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<RecordatorioResponse>> GetById(string id, CancellationToken cancellationToken)
    {
        var recordatorio = await database.Recordatorios
            .AsNoTracking()
            .Include(r => r.Tratamiento)
            .SingleOrDefaultAsync(r => r.IdRecordatorio == id && r.EliminadoEn == null, cancellationToken);

        if (recordatorio is null) return NotFound();

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var cattle = EventosSanitariosController.FindCattle(cattleList, recordatorio.IdAnimal);
        return Ok(RecordatorioResponse.From(recordatorio, cattle, recordatorio.Tratamiento?.Producto));
    }

    [HttpPost]
    public async Task<ActionResult<RecordatorioResponse>> Create(
        RecordatorioRequest request,
        CancellationToken cancellationToken)
    {
        var validationError = await ValidateTratamientoCoherence(request, cancellationToken);
        if (validationError is not null) return validationError;

        var recordatorio = new Recordatorio
        {
            IdRecordatorio = Guid.NewGuid().ToString(),
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        await ApplyAsync(request, recordatorio, cancellationToken);
        database.Recordatorios.Add(recordatorio);
        await database.SaveChangesAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var cattle = EventosSanitariosController.FindCattle(cattleList, recordatorio.IdAnimal);
        var tratamientoProducto = await GetTratamientoProducto(recordatorio.IdTratamiento, cancellationToken);

        var response = RecordatorioResponse.From(recordatorio, cattle, tratamientoProducto);
        return CreatedAtAction(nameof(GetById), new { id = recordatorio.IdRecordatorio }, response);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<RecordatorioResponse>> Update(
        string id,
        RecordatorioRequest request,
        CancellationToken cancellationToken)
    {
        var recordatorio = await database.Recordatorios
            .SingleOrDefaultAsync(r => r.IdRecordatorio == id && r.EliminadoEn == null, cancellationToken);

        if (recordatorio is null) return NotFound();

        var validationError = await ValidateTratamientoCoherence(request, cancellationToken);
        if (validationError is not null) return validationError;

        await ApplyAsync(request, recordatorio, cancellationToken);
        recordatorio.VersionRegistro += 1;
        await database.SaveChangesAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var cattle = EventosSanitariosController.FindCattle(cattleList, recordatorio.IdAnimal);
        var tratamientoProducto = await GetTratamientoProducto(recordatorio.IdTratamiento, cancellationToken);

        return Ok(RecordatorioResponse.From(recordatorio, cattle, tratamientoProducto));
    }

    [HttpPatch("{id}/estado")]
    public async Task<ActionResult<RecordatorioResponse>> CambiarEstado(
        string id,
        [FromQuery] string estado = "Completado",
        CancellationToken cancellationToken = default)
    {
        var recordatorio = await database.Recordatorios
            .Include(r => r.Tratamiento)
            .SingleOrDefaultAsync(r => r.IdRecordatorio == id && r.EliminadoEn == null, cancellationToken);

        if (recordatorio is null) return NotFound();

        // Regla 13: Marcar un recordatorio como completado no demuestra que se haya aplicado el tratamiento;
        // se conserva intacto su registro sanitario.
        var nuevoEstado = string.IsNullOrWhiteSpace(estado) ? "Completado" : estado.Trim();
        recordatorio.Estado = nuevoEstado;
        recordatorio.FechaCompletado = string.Equals(nuevoEstado, "Completado", StringComparison.OrdinalIgnoreCase)
            ? DateTime.UtcNow
            : null;
        recordatorio.VersionRegistro += 1;

        await database.SaveChangesAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var cattle = EventosSanitariosController.FindCattle(cattleList, recordatorio.IdAnimal);
        return Ok(RecordatorioResponse.From(recordatorio, cattle, recordatorio.Tratamiento?.Producto));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var recordatorio = await database.Recordatorios
            .SingleOrDefaultAsync(r => r.IdRecordatorio == id && r.EliminadoEn == null, cancellationToken);

        if (recordatorio is null) return NotFound();

        recordatorio.EliminadoEn = DateTime.UtcNow;
        recordatorio.VersionRegistro += 1;
        await database.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    private async Task<ObjectResult?> ValidateTratamientoCoherence(
        RecordatorioRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdTratamiento)) return null;

        var tratamiento = await database.Tratamientos
            .AsNoTracking()
            .Include(t => t.EventoSanitario)
            .SingleOrDefaultAsync(
                t => t.IdTratamiento == request.IdTratamiento.Trim() && t.EliminadoEn == null,
                cancellationToken);

        if (tratamiento is null || tratamiento.EventoSanitario is null)
        {
            return Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Tratamiento no válido",
                detail: "El tratamiento asociado al recordatorio no existe o fue eliminado.");
        }

        // Regla 12: Tratamiento debe corresponder al animal.
        if (!string.IsNullOrWhiteSpace(request.IdAnimal) &&
            !string.Equals(request.IdAnimal.Trim(), tratamiento.EventoSanitario.IdAnimal, StringComparison.OrdinalIgnoreCase))
        {
            return Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Incoherencia entre tratamiento y animal (Regla 12)",
                detail: "El tratamiento seleccionado pertenece a otro animal distinto al indicado en el recordatorio.");
        }

        return null;
    }

    private async Task ApplyAsync(
        RecordatorioRequest request,
        Recordatorio recordatorio,
        CancellationToken cancellationToken)
    {
        var idAnimal = NullIfEmpty(request.IdAnimal);
        var idTratamiento = NullIfEmpty(request.IdTratamiento);

        if (idTratamiento is not null && idAnimal is null)
        {
            var tratamiento = await database.Tratamientos
                .AsNoTracking()
                .Include(t => t.EventoSanitario)
                .SingleOrDefaultAsync(t => t.IdTratamiento == idTratamiento, cancellationToken);
            idAnimal = tratamiento?.EventoSanitario?.IdAnimal;
        }

        recordatorio.IdRancho = string.IsNullOrWhiteSpace(request.IdRancho) ? DefaultRanchoId : request.IdRancho.Trim();
        recordatorio.IdAnimal = idAnimal;
        recordatorio.IdLote = NullIfEmpty(request.IdLote);
        recordatorio.IdTratamiento = idTratamiento;
        recordatorio.IdResponsable = NullIfEmpty(request.IdResponsable);
        recordatorio.Tipo = request.Tipo.Trim();
        recordatorio.Descripcion = request.Descripcion.Trim();
        recordatorio.FechaProgramada = request.FechaProgramada;
        recordatorio.Estado = request.Estado.Trim();
        recordatorio.FechaCompletado = string.Equals(recordatorio.Estado, "Completado", StringComparison.OrdinalIgnoreCase)
            ? (request.FechaCompletado ?? recordatorio.FechaCompletado ?? DateTime.UtcNow)
            : null;
        recordatorio.IdAutor = string.IsNullOrWhiteSpace(request.IdAutor) ? DefaultAutorId : request.IdAutor.Trim();
    }

    private async Task<string?> GetTratamientoProducto(string? idTratamiento, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(idTratamiento)) return null;
        return await database.Tratamientos
            .AsNoTracking()
            .Where(t => t.IdTratamiento == idTratamiento)
            .Select(t => t.Producto)
            .SingleOrDefaultAsync(cancellationToken);
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
