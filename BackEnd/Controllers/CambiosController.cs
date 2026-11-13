using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record CambioDescargable(long IdCambio, string Entidad, string IdRegistro, int IdRancho,
    string Operacion, DateTime OcurrioEn, JsonElement Datos);
public sealed record LoteCambios(IReadOnlyList<CambioDescargable> Cambios, string? CursorSiguiente, bool HayMas);

[ApiController, Route("api/sync/cambios")]
public sealed class CambiosController(FarmDbContext db, IConfiguration configuration) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<LoteCambios>> Get([FromQuery] string? cursor, [FromQuery] int limite = 100, CancellationToken ct = default)
    {
        if (limite is < 1 or > 200) return BadRequest("El límite debe estar entre 1 y 200.");
        var userClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userClaim, out var userId)) return Unauthorized();

        long lastId = 0;
        if (!string.IsNullOrWhiteSpace(cursor) && !TryReadCursor(cursor, userId, out lastId))
            return BadRequest("El cursor no es válido para este usuario.");

        var ranchIds = await db.UsuarioRanchos.AsNoTracking()
            .Where(x => x.IdUsuario == userId && x.Estado == "Activo" && x.FechaBaja == null)
            .Select(x => x.IdRancho).Distinct().ToListAsync(ct);
        if (ranchIds.Count == 0) return Ok(new LoteCambios([], cursor, false));

        var batch = await db.CambiosServidor.AsNoTracking()
            .Where(x => x.IdCambio > lastId && x.IdRancho != null && ranchIds.Contains(x.IdRancho.Value))
            .OrderBy(x => x.IdCambio)
            .Take(limite + 1)
            .ToListAsync(ct);
        var hayMas = batch.Count > limite;
        if (hayMas) batch.RemoveAt(batch.Count - 1);
        var changes = batch.Select(x => new CambioDescargable(
            x.IdCambio, x.Entidad, x.IdRegistro, x.IdRancho!.Value, x.Operacion, x.OcurrioEn,
            JsonDocument.Parse(x.DatosJson).RootElement.Clone())).ToArray();
        var nextCursor = batch.Count == 0 ? cursor : CreateCursor(userId, batch[^1].IdCambio);
        return Ok(new LoteCambios(changes, nextCursor, hayMas));
    }

    private string CreateCursor(int userId, long lastId)
    {
        var payload = Base64Url(Encoding.UTF8.GetBytes($"{userId}:{lastId}"));
        return $"{payload}.{Base64Url(HMACSHA256.HashData(GetKey(), Encoding.UTF8.GetBytes(payload)))}";
    }

    private bool TryReadCursor(string cursor, int userId, out long lastId)
    {
        lastId = 0;
        var parts = cursor.Split('.', StringSplitOptions.None);
        if (parts.Length != 2) return false;
        byte[] provided;
        byte[] suppliedPayload;
        try { provided = FromBase64Url(parts[1]); suppliedPayload = FromBase64Url(parts[0]); }
        catch (FormatException) { return false; }
        var expected = HMACSHA256.HashData(GetKey(), Encoding.UTF8.GetBytes(parts[0]));
        if (!CryptographicOperations.FixedTimeEquals(provided, expected)) return false;
        var values = Encoding.UTF8.GetString(suppliedPayload).Split(':', StringSplitOptions.None);
        return values.Length == 2 && int.TryParse(values[0], out var cursorUser) && cursorUser == userId &&
            long.TryParse(values[1], out lastId) && lastId >= 0;
    }

    private byte[] GetKey() => Encoding.UTF8.GetBytes(configuration["Authentication:SigningKey"]!);
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] FromBase64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }
}
