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
            : this.NotFoundProblem("La asignación usuario-rancho solicitada no existe.");

    [HttpPost]
    [ProducesResponseType(typeof(UsuarioRanchoResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(UsuarioRanchoResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<UsuarioRanchoResponseDto>> Create(
        [FromServices] RanchAccessService access, UsuarioRanchoCreateDto dto, CancellationToken ct)
    {
        var id = dto.IdUsuarioRancho ?? Guid.NewGuid();

        var existing = await db.UsuarioRanchos.AsNoTracking().FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct);
        if (existing is not null)
        {
            return MatchesUsuarioRancho(existing, dto)
                ? Ok(ToResponseDto(existing))
                : this.ConflictProblem("Ya existe una asignación con el identificador proporcionado y contenido diferente.");
        }

        var userExists = await db.Usuarios.AsNoTracking().AnyAsync(u => u.IdUsuario == dto.IdUsuario, ct);
        if (!userExists) return this.ValidationError("El usuario especificado no existe.", nameof(dto.IdUsuario));

        var ranchoExists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == dto.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists) return this.ValidationError("El rancho especificado no existe o está eliminado.", nameof(dto.IdRancho));

        var item = new UsuarioRancho
        {
            IdUsuarioRancho = id,
            IdUsuario = dto.IdUsuario,
            IdRancho = dto.IdRancho,
            Rol = dto.Rol.Trim(),
            Estado = dto.Estado.Trim(),
            FechaAlta = ApiProblemResults.EnsureUtc(dto.FechaAlta ?? DateTime.UtcNow),
            FechaBaja = ApiProblemResults.EnsureUtc(dto.FechaBaja)
        };

        db.UsuarioRanchos.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            var collision = await db.UsuarioRanchos.AsNoTracking().FirstOrDefaultAsync(ur => ur.IdUsuarioRancho == id, ct);
            if (collision is not null)
            {
                var userId = RanchAccessService.GetUserId(User) ?? Guid.Empty;
                var adminRanchIds = access.AdminRanchIds(userId);
                if (collision.IdUsuario == userId || adminRanchIds.Contains(collision.IdRancho))
                {
                    return MatchesUsuarioRancho(collision, dto)
                        ? Ok(ToResponseDto(collision))
                        : this.ConflictProblem("Ya existe una asignación con el identificador proporcionado y contenido diferente.");
                }

                return this.ConflictProblem("Conflicto con un recurso existente.");
            }

            return this.ConflictProblem("La asignación ya existe o el usuario/rancho no existen.");
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
        if (item is null) return this.NotFoundProblem("La asignación usuario-rancho solicitada no existe.");

        if (dto.IdUsuario != item.IdUsuario)
            return this.ValidationError("No se permite cambiar el usuario de una asignación usuario-rancho.", nameof(dto.IdUsuario));

        if (dto.IdRancho != item.IdRancho)
            return this.ValidationError("No se permite cambiar el rancho de una asignación usuario-rancho.", nameof(dto.IdRancho));

        var userExists = await db.Usuarios.AsNoTracking().AnyAsync(u => u.IdUsuario == dto.IdUsuario, ct);
        if (!userExists) return this.ValidationError("El usuario especificado no existe.", nameof(dto.IdUsuario));

        var ranchoExists = await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == dto.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists) return this.ValidationError("El rancho especificado no existe o está eliminado.", nameof(dto.IdRancho));

        item.IdUsuario = dto.IdUsuario;
        item.IdRancho = dto.IdRancho;
        item.Rol = dto.Rol.Trim();
        item.Estado = dto.Estado.Trim();
        if (dto.FechaAlta.HasValue) item.FechaAlta = ApiProblemResults.EnsureUtc(dto.FechaAlta.Value);
        item.FechaBaja = ApiProblemResults.EnsureUtc(dto.FechaBaja);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("La asignación ya existe o el usuario/rancho no existen.");
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
        if (item is null) return this.NotFoundProblem("La asignación usuario-rancho solicitada no existe.");

        db.UsuarioRanchos.Remove(item);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return this.ConflictProblem("No se pudo eliminar la asignación usuario-rancho por una restricción de integridad.");
        }

        return NoContent();
    }

    private static bool MatchesUsuarioRancho(UsuarioRancho existing, UsuarioRanchoCreateDto dto) =>
        existing.IdUsuario == dto.IdUsuario &&
        existing.IdRancho == dto.IdRancho &&
        ApiProblemResults.SameText(existing.Rol, dto.Rol) &&
        ApiProblemResults.SameText(existing.Estado, dto.Estado) &&
        ApiProblemResults.SameUtcInstant(existing.FechaAlta, dto.FechaAlta ?? existing.FechaAlta) &&
        ApiProblemResults.SameUtcInstant(existing.FechaBaja, dto.FechaBaja);

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
