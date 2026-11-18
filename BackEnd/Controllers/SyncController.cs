using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record CambioPullResponse(
    Guid RemoteId,
    Guid? ClientUuid,
    string Operacion,
    long VersionServidor,
    JsonElement? Datos,
    bool Eliminado,
    DateTime ActualizadoEnServidor);

public sealed record CambiosPullResponse(
    string Entidad,
    IReadOnlyList<CambioPullResponse> Cambios,
    string? SiguienteCursorOpaco,
    bool HayMasPaginas,
    DateTime FechaServidor);

[ApiController]
[Route("api/sync/cambios")]
[Authorize]
public sealed class SyncController(FarmDbContext db) : ControllerBase
{
    private static readonly IReadOnlyDictionary<string, string[]> ServerEntitiesByClientEntity =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["cattle"] = [nameof(Animal)],
            ["lots"] = [nameof(Lote)],
            ["healthRecords"] = [nameof(EventoSanitario), nameof(Tratamiento)],
            ["feedingRecords"] = [nameof(Alimentacion)],
            ["movements"] = [nameof(MovimientoAnimal)],
            ["alerts"] = [nameof(Recordatorio)]
        };

    [HttpGet]
    public async Task<ActionResult<CambiosPullResponse>> GetCambios(
        [FromQuery] string? entidad,
        [FromQuery(Name = "idRancho")] Guid? idRancho,
        [FromQuery(Name = "ranchId")] Guid? ranchId,
        [FromQuery(Name = "cursor")] string? cursor,
        [FromQuery(Name = "cursorOpaco")] string? cursorOpaco,
        [FromQuery] int limite = 100,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(entidad) ||
            !ServerEntitiesByClientEntity.TryGetValue(entidad, out var serverEntities))
            return BadRequest(new { mensaje = "La entidad no tiene sincronización Pull configurada." });

        var userText = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(userText, out var idUsuario) || idUsuario == Guid.Empty)
            return Unauthorized();

        var requestedRanchId = idRancho.GetValueOrDefault() != Guid.Empty
            ? idRancho.GetValueOrDefault()
            : ranchId.GetValueOrDefault();
        if (requestedRanchId == Guid.Empty)
        {
            var activeRanchIds = await db.UsuarioRanchos.AsNoTracking()
                .Where(ur => ur.IdUsuario == idUsuario && ur.FechaBaja == null &&
                             ur.Estado.ToLower() == "activo")
                .Join(db.Ranchos.AsNoTracking().Where(r => r.EliminadoEn == null),
                    ur => ur.IdRancho, r => r.IdRancho, (ur, r) => ur.IdRancho)
                .Distinct()
                .Take(2)
                .ToListAsync(ct);

            if (activeRanchIds.Count != 1)
                return BadRequest(new { mensaje = "Indica ranchId cuando el usuario tenga cero o varios ranchos activos." });
            requestedRanchId = activeRanchIds[0];
        }

        var tieneAcceso = await (from ur in db.UsuarioRanchos.AsNoTracking()
                                 join usuario in db.Usuarios.AsNoTracking() on ur.IdUsuario equals usuario.IdUsuario
                                 join rancho in db.Ranchos.AsNoTracking() on ur.IdRancho equals rancho.IdRancho
                                 where ur.IdUsuario == idUsuario && ur.IdRancho == requestedRanchId &&
                                       ur.FechaBaja == null && ur.Estado.ToLower() == "activo" &&
                                       usuario.Estado.ToLower() == "activo" && rancho.EliminadoEn == null
                                 select ur.IdUsuarioRancho).AnyAsync(ct);
        if (!tieneAcceso)
            return Forbid();

        limite = Math.Clamp(limite, 1, 500);
        var effectiveCursor = !string.IsNullOrWhiteSpace(cursorOpaco) ? cursorOpaco : cursor;
        DateTime? fechaCursor = null;
        Guid idCursor = Guid.Empty;
        if (!string.IsNullOrWhiteSpace(effectiveCursor) &&
            !TryDecodeCursor(effectiveCursor, out fechaCursor, out idCursor))
            return BadRequest(new { mensaje = "El cursor no es válido." });

        var query = db.CambiosServidor.AsNoTracking()
            .Where(c => c.IdRancho == requestedRanchId && serverEntities.Contains(c.Entidad));
        if (fechaCursor.HasValue)
        {
            var fecha = fechaCursor.Value;
            query = query.Where(c => c.OcurrioEn > fecha ||
                                     (c.OcurrioEn == fecha && c.IdCambio.CompareTo(idCursor) > 0));
        }

        var page = await query.OrderBy(c => c.OcurrioEn).ThenBy(c => c.IdCambio)
            .Take(limite + 1).ToListAsync(ct);
        var hasMore = page.Count > limite;
        if (hasMore)
            page.RemoveAt(limite);

        var cambios = new List<CambioPullResponse>(page.Count);
        foreach (var change in page)
            cambios.Add(await ToPullChangeAsync(entidad, requestedRanchId, change, ct));
        var nextCursor = page.Count > 0
            ? EncodeCursor(page[^1].OcurrioEn, page[^1].IdCambio)
            : effectiveCursor;

        return Ok(new CambiosPullResponse(
            entidad,
            cambios,
            nextCursor,
            hasMore,
            DateTime.UtcNow));
    }

    private async Task<CambioPullResponse> ToPullChangeAsync(
        string clientEntity,
        Guid ranchId,
        CambioServidor change,
        CancellationToken ct)
    {
        var deleted = string.Equals(change.Operacion, "Eliminar", StringComparison.OrdinalIgnoreCase) ||
                      string.Equals(change.Operacion, "DELETE", StringComparison.OrdinalIgnoreCase);
        JsonElement? data = null;
        if (!deleted)
        {
            data = string.Equals(clientEntity, "healthRecords", StringComparison.OrdinalIgnoreCase) &&
                   string.Equals(change.Entidad, nameof(Tratamiento), StringComparison.OrdinalIgnoreCase)
                ? await MapTreatmentDataAsync(change.Datos, ranchId, ct)
                : MapData(clientEntity, change.Datos);
        }

        return new CambioPullResponse(
            change.IdRegistro,
            null,
            deleted ? "DELETE" : "UPSERT",
            change.Version,
            data,
            deleted,
            DateTime.SpecifyKind(change.OcurrioEn, DateTimeKind.Utc));
    }

    private async Task<JsonElement?> MapTreatmentDataAsync(string? rawJson, Guid ranchId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
            return null;

        using var document = JsonDocument.Parse(rawJson);
        var source = document.RootElement;
        if (!TryGetProperty(source, "IdEventoSanitario", out var eventIdValue) ||
            !Guid.TryParse(eventIdValue.GetString(), out var eventId))
            return null;

        var animalId = await (from healthEvent in db.EventosSanitarios.AsNoTracking()
                              join animal in db.Animales.AsNoTracking()
                                  on healthEvent.IdAnimal equals animal.IdAnimal
                              where healthEvent.IdEventoSanitario == eventId &&
                                    animal.IdRancho == ranchId
                              select (Guid?)animal.IdAnimal).FirstOrDefaultAsync(ct);
        if (animalId is null)
            return null;

        var producto = TryGetString(source, "Producto") ?? "Tratamiento";
        var dosis = TryGetProperty(source, "Dosis", out var dosisValue)
            ? dosisValue.ToString()
            : string.Empty;
        var unidad = TryGetString(source, "UnidadDosis") ?? string.Empty;
        var fecha = TryGetString(source, "FechaInicio") ?? DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);

        return JsonSerializer.SerializeToElement(new
        {
            cattleId = animalId.Value,
            ranchId,
            tipo = "Tratamiento",
            descripcion = string.Join(" ", new[] { producto, dosis, unidad }.Where(part => !string.IsNullOrWhiteSpace(part))),
            fecha
        });
    }

    private static JsonElement? MapData(string clientEntity, string? rawJson)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
            return null;

        using var document = JsonDocument.Parse(rawJson);
        var source = document.RootElement;
        if (source.ValueKind != JsonValueKind.Object)
            return source.Clone();

        var data = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        void Copy(string target, params string[] sources)
        {
            foreach (var sourceName in sources)
            {
                if (TryGetProperty(source, sourceName, out var value))
                {
                    data[target] = value.Clone();
                    return;
                }
            }
        }

        void CopyFirstNonEmpty(string target, params string[] candidates)
        {
            foreach (var candidate in candidates)
            {
                if (TryGetProperty(source, candidate, out var value) &&
                    value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()))
                {
                    data[target] = value.Clone();
                    return;
                }
            }
        }

        Copy("ranchId", "IdRancho", "ranchId", "ranchoId");
        Copy("createdAt", "CreadoEn", "createdAt", "fechaCreacion");

        switch (clientEntity.ToLowerInvariant())
        {
            case "cattle":
                Copy("areteSiniiga", "Arete", "areteSiniiga", "tagNumber");
                Copy("nombre", "Nombre", "nombre", "name");
                Copy("raza", "Raza", "raza", "breed");
                Copy("gender", "Sexo", "gender", "sex", "sexo");
                Copy("fechaNacimiento", "FechaNacimiento", "fechaNacimiento", "birthDate");
                Copy("loteId", "IdLote", "loteId", "lotId");
                break;
            case "lots":
                Copy("nombre", "Nombre", "nombre", "name");
                Copy("capacidad", "Capacidad", "capacidad", "capacity");
                Copy("ubicacion", "Ubicacion", "ubicacion", "location");
                break;
            case "healthrecords":
                Copy("cattleId", "IdAnimal", "cattleId", "animalId");
                Copy("tipo", "Tipo", "tipo", "type");
                CopyFirstNonEmpty("descripcion", "Diagnostico", "Sintomas", "Observaciones", "Descripcion");
                if (!data.ContainsKey("descripcion"))
                    Copy("descripcion", "Tipo", "tipo");
                Copy("fecha", "Fecha", "fecha", "date");
                break;
            case "feedingrecords":
                Copy("tipoAlimento", "Alimento", "tipoAlimento", "feedType");
                Copy("cantidadKg", "Cantidad", "cantidad", "cantidadKg", "quantityKg");
                Copy("fecha", "Inicio", "fecha", "date");
                Copy("lotId", "IdLote", "lotId", "loteId");
                Copy("cattleId", "IdAnimal", "cattleId", "animalId");
                break;
            case "movements":
                Copy("cattleId", "IdAnimal", "cattleId", "animalId");
                Copy("fecha", "Fecha", "fecha", "date");
                Copy("motivo", "Motivo", "motivo", "reason");
                Copy("origenLotId", "IdLoteOrigen", "origenLotId", "originLotId");
                Copy("destinoLotId", "IdLoteDestino", "destinoLotId", "destinationLotId");
                break;
            case "alerts":
                Copy("tipo", "Tipo", "tipo", "type");
                Copy("mensaje", "Descripcion", "mensaje", "message");
                Copy("fecha", "FechaProgramada", "fecha", "date");
                Copy("ranchId", "IdRancho", "ranchId", "ranchoId");
                data["prioridad"] = JsonSerializer.SerializeToElement("Media");
                data["leida"] = JsonSerializer.SerializeToElement(
                    TryGetString(source, "Estado")?.Equals("Completado", StringComparison.OrdinalIgnoreCase) == true);
                break;
        }

        return JsonSerializer.SerializeToElement(data);
    }

    private static bool TryGetProperty(JsonElement source, string name, out JsonElement value)
    {
        foreach (var property in source.EnumerateObject())
        {
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                value = property.Value;
                return true;
            }
        }
        value = default;
        return false;
    }

    private static string? TryGetString(JsonElement source, string name) =>
        TryGetProperty(source, name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

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
                    DateTimeStyles.RoundtripKind, out var parsed) || !Guid.TryParse(parts[1], out id))
                return false;
            date = DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
