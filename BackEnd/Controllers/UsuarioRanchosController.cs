using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[RanchScope(RanchResource.UsuarioRancho, AdminForCreate = true, AdminForUpdateDelete = true)]
[Route("api/usuario-ranchos")]
public sealed class UsuarioRanchosController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(List<UsuarioRanchoResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<UsuarioRanchoResponseDto>>> GetAll([FromServices] RanchAccessService access, CancellationToken ct)
    {
        // Un administrador ve las membresías de sus ranchos; cualquier usuario ve las propias.
        var userId = RanchAccessService.GetUserId(User) ?? Guid.Empty;
        var adminRanchIds = access.AdminRanchIds(userId);
        var items = await db.UsuarioRanchos.AsNoTracking()
            .Where(ur => ur.IdUsuario == userId || adminRanchIds.Contains(ur.IdRancho))
            .Select(ur => ToResponseDto(ur))
            .ToListAsync(ct);
        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(UsuarioRanchoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UsuarioRanchoResponseDto>> Get(Guid id, CancellationToken ct) =>
        await db.UsuarioRanchos.AsNoTracking().FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct) is { } item
            ? Ok(ToResponseDto(item))
            : NotFound();

    [HttpPost]
    [ProducesResponseType(typeof(UsuarioRanchoResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(UsuarioRanchoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<UsuarioRanchoResponseDto>> Create(UsuarioRanchoCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdUsuarioRancho is { } clientId && clientId != Guid.Empty
            ? clientId
            : Guid.NewGuid();

        var existing = await db.UsuarioRanchos.AsNoTracking()
            .FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct);
        if (existing is not null)
            return Ok(ToResponseDto(existing));

        if (dto.IdUsuario == Guid.Empty || dto.IdRancho == Guid.Empty ||
            string.IsNullOrWhiteSpace(dto.Rol) || string.IsNullOrWhiteSpace(dto.Estado))
        {
            return BadRequest("IdUsuario, IdRancho, rol y estado son obligatorios.");
        }

        var item = new UsuarioRancho
        {
            IdUsuarioRancho = id,
            IdUsuario = dto.IdUsuario,
            IdRancho = dto.IdRancho,
            Rol = dto.Rol.Trim(),
            Estado = dto.Estado.Trim(),
            FechaAlta = dto.FechaAlta ?? DateTime.UtcNow,
            FechaBaja = dto.FechaBaja
        };

        db.UsuarioRanchos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("La asignación ya existe o el usuario/rancho no existen.");
        }

        return CreatedAtAction(nameof(Get), new { id = item.IdUsuarioRancho }, ToResponseDto(item));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(Guid id, UsuarioRanchoUpdateDto dto, CancellationToken ct)
    {
        var item = await db.UsuarioRanchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        item.IdUsuario = dto.IdUsuario;
        item.IdRancho = dto.IdRancho;
        item.Rol = dto.Rol.Trim();
        item.Estado = dto.Estado.Trim();
        if (dto.FechaAlta.HasValue) item.FechaAlta = dto.FechaAlta.Value;
        item.FechaBaja = dto.FechaBaja;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("La asignación ya existe o el usuario/rancho no existen.");
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
        var item = await db.UsuarioRanchos.FindAsync([id], ct);
        if (item is null) return NotFound();

        db.UsuarioRanchos.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict("No se pudo eliminar la asignación usuario-rancho por una restricción de integridad.");
        }

        return NoContent();
    }

    private static UsuarioRanchoResponseDto ToResponseDto(UsuarioRancho ur) => new()
    {
        IdUsuarioRancho = ur.IdUsuarioRancho,
        IdUsuario = ur.IdUsuario,
        IdRancho = ur.IdRancho,
        Rol = ur.Rol,
        Estado = ur.Estado,
        FechaAlta = ur.FechaAlta,
        FechaBaja = ur.FechaBaja
    };
}
