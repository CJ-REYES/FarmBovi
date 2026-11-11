using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/eventos-sanitarios")]
[Produces("application/json")]
public sealed class EventosSanitariosController(FarmDbContext database) : ControllerBase
{
    private const string DefaultAutorId = "00000000-0000-0000-0000-000000000001";

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<EventoSanitarioResponse>>> GetAll(
        [FromQuery] string? idAnimal,
        CancellationToken cancellationToken)
    {
        var query = database.EventosSanitarios
            .AsNoTracking()
            .Include(e => e.Tratamientos)
            .Where(e => e.EliminadoEn == null);

        if (!string.IsNullOrWhiteSpace(idAnimal))
        {
            var trimmed = idAnimal.Trim();
            query = query.Where(e => e.IdAnimal == trimmed);
        }

        var eventos = await query
            .OrderByDescending(e => e.Fecha)
            .ThenByDescending(e => e.CreadoEn)
            .ToListAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var result = eventos
            .Select(e => EventoSanitarioResponse.From(e, FindCattle(cattleList, e.IdAnimal)))
            .ToList();

        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<EventoSanitarioResponse>> GetById(string id, CancellationToken cancellationToken)
    {
        var evento = await database.EventosSanitarios
            .AsNoTracking()
            .Include(e => e.Tratamientos)
            .SingleOrDefaultAsync(e => e.IdEventoSanitario == id && e.EliminadoEn == null, cancellationToken);

        if (evento is null) return NotFound();

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        return Ok(EventoSanitarioResponse.From(evento, FindCattle(cattleList, evento.IdAnimal)));
    }

    [HttpPost]
    public async Task<ActionResult<EventoSanitarioResponse>> Create(
        EventoSanitarioRequest request,
        CancellationToken cancellationToken)
    {
        var evento = new EventoSanitario
        {
            IdEventoSanitario = Guid.NewGuid().ToString(),
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        Apply(request, evento);
        database.EventosSanitarios.Add(evento);
        await database.SaveChangesAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        var response = EventoSanitarioResponse.From(evento, FindCattle(cattleList, evento.IdAnimal));
        return CreatedAtAction(nameof(GetById), new { id = evento.IdEventoSanitario }, response);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<EventoSanitarioResponse>> Update(
        string id,
        EventoSanitarioRequest request,
        CancellationToken cancellationToken)
    {
        var evento = await database.EventosSanitarios
            .Include(e => e.Tratamientos)
            .SingleOrDefaultAsync(e => e.IdEventoSanitario == id && e.EliminadoEn == null, cancellationToken);

        if (evento is null) return NotFound();

        Apply(request, evento);
        evento.VersionRegistro += 1;

        await database.SaveChangesAsync(cancellationToken);

        var cattleList = await database.Cattle.AsNoTracking().ToListAsync(cancellationToken);
        return Ok(EventoSanitarioResponse.From(evento, FindCattle(cattleList, evento.IdAnimal)));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var evento = await database.EventosSanitarios
            .SingleOrDefaultAsync(e => e.IdEventoSanitario == id && e.EliminadoEn == null, cancellationToken);

        if (evento is null) return NotFound();

        evento.EliminadoEn = DateTime.UtcNow;
        evento.VersionRegistro += 1;
        await database.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    private static void Apply(EventoSanitarioRequest request, EventoSanitario evento)
    {
        evento.IdAnimal = request.IdAnimal.Trim();
        evento.Tipo = request.Tipo.Trim();
        evento.Fecha = request.Fecha;
        evento.Sintomas = NullIfEmpty(request.Sintomas);
        evento.Diagnostico = NullIfEmpty(request.Diagnostico);
        evento.ProfesionalDiagnostico = NullIfEmpty(request.ProfesionalDiagnostico);
        evento.EvidenciaDiagnosticoUri = NullIfEmpty(request.EvidenciaDiagnosticoUri);
        evento.Responsable = request.Responsable.Trim();
        evento.Observaciones = NullIfEmpty(request.Observaciones);
        evento.IdAutor = string.IsNullOrWhiteSpace(request.IdAutor) ? DefaultAutorId : request.IdAutor.Trim();
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    internal static Cattle? FindCattle(IReadOnlyList<Cattle> cattleList, string? idAnimal)
    {
        if (string.IsNullOrWhiteSpace(idAnimal)) return null;
        var key = idAnimal.Trim();
        return cattleList.FirstOrDefault(c =>
            c.Id.ToString() == key ||
            string.Equals(c.EarTag, key, StringComparison.OrdinalIgnoreCase));
    }
}
