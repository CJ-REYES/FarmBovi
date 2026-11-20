using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.Rancho, AdminForUpdateDelete = true)]
[Route("api/ranchos")]
public sealed class RanchosController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<RanchoResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<RanchoResponseDto>>> GetAll([FromServices] RanchAccessService access, [FromQuery] bool incluirEliminados = false, CancellationToken ct = default)
    {
        var query = db.Ranchos.AsNoTracking();
        if (!incluirEliminados)
            query = query.Where(r => r.EliminadoEn == null);

        // Solo registros de ranchos donde el usuario tiene membresía activa.
        var ranchIds = access.ActiveRanchIds(RanchAccessService.GetUserId(User) ?? Guid.Empty);
        query = query.Where(x => ranchIds.Contains(x.IdRancho));

        var items = await query.Select(r => ToResponseDto(r)).ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(RanchoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RanchoResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.Ranchos.AsNoTracking().FirstOrDefaultAsync(r => r.IdRancho == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : NotFound();

    [HttpPost]
    [ProducesResponseType(typeof(RanchoResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(RanchoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RanchoResponseDto>> Create(RanchoCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdRancho is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.Ranchos.AsNoTracking().FirstOrDefaultAsync(r => r.IdRancho == id, ct);
        if (existing is not null)
            return Ok(ToResponseDto(existing));

        if (string.IsNullOrWhiteSpace(dto.Nombre) ||
            string.IsNullOrWhiteSpace(dto.UbicacionGeneral) ||
            string.IsNullOrWhiteSpace(dto.Estado))
        {
            return BadRequest("Nombre, ubicación general y estado del rancho son obligatorios.");
        }

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, dto.IdAutor, ct);
        if (authorError is not null) return BadRequest(authorError);

        var item = new Rancho
        {
            IdRancho = id,
            Nombre = dto.Nombre.Trim(),
            UbicacionGeneral = dto.UbicacionGeneral.Trim(),
            Estado = dto.Estado.Trim(),
            IdAutor = authorId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1
        };

        db.Ranchos.Add(item);
        // Quien crea el rancho queda como su administrador para poder operarlo con las reglas por rancho.
        if (RanchAccessService.GetUserId(User) is { } creatorId)
        {
            db.UsuarioRanchos.Add(new UsuarioRancho
            {
                IdUsuarioRancho = Guid.NewGuid(),
                IdUsuario = creatorId,
                IdRancho = item.IdRancho,
                Rol = "Admin",
                Estado = "Activo",
                FechaAlta = DateTime.UtcNow
            });
        }
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo crear el rancho.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdRancho }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, RanchoUpdateDto dto, CancellationToken ct)
    {
        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var (authorId, authorError) = await validator.ResolveAuthorAsync(User, Guid.Empty, ct);
        if (authorError is not null) return BadRequest(authorError);

        item.Nombre = dto.Nombre.Trim();
        item.UbicacionGeneral = dto.UbicacionGeneral.Trim();
        item.Estado = dto.Estado.Trim();
        item.IdAutor = authorId;
        item.VersionRegistro++;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo actualizar el rancho.");
        }

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.Ranchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        var hasDependencies =
            await db.Lotes.AsNoTracking().AnyAsync(l => l.IdRancho == id && l.EliminadoEn == null, ct) ||
            await db.Animales.AsNoTracking().AnyAsync(a => a.IdRancho == id && a.EliminadoEn == null, ct) ||
            await db.UsuarioRanchos.AsNoTracking().AnyAsync(ur => ur.IdRancho == id && ur.FechaBaja == null, ct);

        if (hasDependencies)
            return Conflict("No se puede eliminar un rancho que tiene lotes, animales o usuarios asociados.");

        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        return NoContent();
    }

    private static RanchoResponseDto ToResponseDto(Rancho r) => new()
    {
        IdRancho = r.IdRancho,
        Nombre = r.Nombre,
        UbicacionGeneral = r.UbicacionGeneral,
        Estado = r.Estado,
        IdAutor = r.IdAutor,
        CreadoEn = r.CreadoEn,
        VersionRegistro = r.VersionRegistro
    };
}
