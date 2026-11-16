using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record CambioResponse(Guid IdCambio, Guid IdRancho, string Entidad, Guid IdRegistro,
    string Operacion, long Version, DateTime OcurrioEn, Guid? IdUsuario, JsonElement? Datos);

public sealed record CambiosResponse(IReadOnlyList<CambioResponse> Cambios, string? SiguienteCursor, bool HayMas);

[ApiController]
[Route("api/sync/cambios")]
[Authorize]
public sealed class SyncController(FarmDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<CambiosResponse>> GetCambios(
        [FromQuery] Guid idRancho, [FromQuery] string? cursor, [FromQuery] int limite = 100,
        CancellationToken ct = default)
    {
        if (idRancho == Guid.Empty) return BadRequest(new { mensaje = "idRancho es obligatorio." });
        var idUsuarioClaim = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(idUsuarioClaim, out var idUsuario)) return Unauthorized();

        var tieneAcceso = await (from ur in db.UsuarioRanchos.AsNoTracking()
                                 join usuario in db.Usuarios.AsNoTracking() on ur.IdUsuario equals usuario.IdUsuario
                                 join rancho in db.Ranchos.AsNoTracking() on ur.IdRancho equals rancho.IdRancho
                                 where ur.IdUsuario == idUsuario && ur.IdRancho == idRancho && ur.FechaBaja == null &&
                                       ur.Estado.ToLower() == "activo" && usuario.Estado.ToLower() == "activo" &&
                                       rancho.EliminadoEn == null
                                 select ur.IdUsuarioRancho).AnyAsync(ct);
        if (!tieneAcceso) return Forbid();

        limite = Math.Clamp(limite, 1, 500);
        DateTime? fechaCursor = null;
        Guid idCursor = Guid.Empty;
        if (!string.IsNullOrWhiteSpace(cursor) && !TryDecodeCursor(cursor, out fechaCursor, out idCursor))
            return BadRequest(new { mensaje = "El cursor no es válido." });

        var query = db.CambiosServidor.AsNoTracking().Where(c => c.IdRancho == idRancho);
        if (fechaCursor.HasValue)
        {
            var fecha = fechaCursor.Value;
            query = query.Where(c => c.OcurrioEn > fecha || (c.OcurrioEn == fecha && c.IdCambio.CompareTo(idCursor) > 0));
        }

        var page = await query.OrderBy(c => c.OcurrioEn).ThenBy(c => c.IdCambio)
            .Take(limite + 1).ToListAsync(ct);
        var hasMore = page.Count > limite;
        if (hasMore) page.RemoveAt(limite);

        var changes = page.Select(c => new CambioResponse(c.IdCambio, c.IdRancho, c.Entidad,
            c.IdRegistro, c.Operacion, c.Version, DateTime.SpecifyKind(c.OcurrioEn, DateTimeKind.Utc),
            c.IdUsuario, ParseData(c.Datos))).ToList();
        var next = page.Count == 0 ? null : EncodeCursor(page[^1].OcurrioEn, page[^1].IdCambio);
        return Ok(new CambiosResponse(changes, next, hasMore));
    }

    private static JsonElement? ParseData(string? data)
    {
        if (string.IsNullOrWhiteSpace(data)) return null;
        using var document = JsonDocument.Parse(data);
        return document.RootElement.Clone();
    }

    private static string EncodeCursor(DateTime date, Guid id)
    {
        var value = $"{date.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)}|{id:D}";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static bool TryDecodeCursor(string cursor, out DateTime? date, out Guid id)
    {
        date = null;
        id = Guid.Empty;
        try
        {
            var base64 = cursor.Replace('-', '+').Replace('_', '/');
            base64 += new string('=', (4 - base64.Length % 4) % 4);
            var parts = Encoding.UTF8.GetString(Convert.FromBase64String(base64)).Split('|', 2);
            if (parts.Length != 2 || !DateTime.TryParse(parts[0], CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var parsed) || !Guid.TryParse(parts[1], out id)) return false;
            date = DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
            return true;
        }
        catch (FormatException) { return false; }
    }
}
