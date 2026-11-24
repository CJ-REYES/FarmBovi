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

/// <summary>
/// Error de procesamiento Pull (HTTP 422). <c>CursorVigente</c> es el mismo cursor recibido:
/// el cliente no debe avanzar su cursor local.
/// </summary>
public sealed record PullErrorResponse(
    string Codigo,
    string Mensaje,
    string Entidad,
    Guid IdCambio,
    string EntidadServidor,
    Guid RemoteId,
    string? CursorVigente);

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
            ["genealogy"] = [nameof(GenealogiaAnimal)],
            ["weighings"] = [nameof(Pesaje)],
            ["healthRecords"] = [nameof(EventoSanitario), nameof(Tratamiento)],
            ["feedingRecords"] = [nameof(Alimentacion)],
            ["reproductionRecords"] = [nameof(EventoReproductivo)],
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
                .OrderBy(id => id)
                .Take(2)
                .ToListAsync(ct);

            if (activeRanchIds.Count == 0)
            {
                return Ok(new CambiosPullResponse(
                    entidad,
                    Array.Empty<CambioPullResponse>(),
                    null,
                    false,
                    DateTime.UtcNow));
            }

            if (activeRanchIds.Count > 1)
                return BadRequest(new { mensaje = "Indica ranchId cuando el usuario tenga varios ranchos activos." });
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

        // Se procesa en orden; ante el primer cambio que no puede construirse se corta la página
        // para que el cursor nunca avance más allá de un registro no entregado.
        var cambios = new List<CambioPullResponse>(page.Count);
        CambioServidor? lastDelivered = null;
        foreach (var change in page)
        {
            var (pullChange, error) = await ToPullChangeAsync(entidad, requestedRanchId, change, ct);
            if (error is not null)
            {
                if (cambios.Count == 0)
                {
                    return UnprocessableEntity(new PullErrorResponse(
                        error.Value.Codigo,
                        error.Value.Mensaje,
                        entidad,
                        change.IdCambio,
                        change.Entidad,
                        change.IdRegistro,
                        effectiveCursor));
                }

                hasMore = true;
                break;
            }

            cambios.Add(pullChange!);
            lastDelivered = change;
        }

        var nextCursor = lastDelivered is not null
            ? EncodeCursor(lastDelivered.OcurrioEn, lastDelivered.IdCambio)
            : effectiveCursor;

        return Ok(new CambiosPullResponse(
            entidad,
            cambios,
            nextCursor,
            hasMore,
            DateTime.UtcNow));
    }

    private static readonly string[] UpsertOperations = ["Crear", "Actualizar", "CREATE", "UPDATE", "UPSERT"];
    private static readonly string[] DeleteOperations = ["Eliminar", "DELETE"];

    private async Task<(CambioPullResponse? Change, (string Codigo, string Mensaje)? Error)> ToPullChangeAsync(
        string clientEntity,
        Guid ranchId,
        CambioServidor change,
        CancellationToken ct)
    {
        var deleted = DeleteOperations.Contains(change.Operacion, StringComparer.OrdinalIgnoreCase);
        if (!deleted && !UpsertOperations.Contains(change.Operacion, StringComparer.OrdinalIgnoreCase))
            return (null, ("OPERACION_DESCONOCIDA", $"La operación '{change.Operacion}' no se puede sincronizar."));

        JsonElement? data = null;
        if (deleted)
        {
            if (string.Equals(change.Entidad, nameof(Pesaje), StringComparison.OrdinalIgnoreCase))
            {
                var weighingAnimal = await (from pesaje in db.Pesajes.AsNoTracking()
                                            join animal in db.Animales.AsNoTracking()
                                                on pesaje.IdAnimal equals animal.IdAnimal into animalGroup
                                            from animal in animalGroup.DefaultIfEmpty()
                                            where pesaje.IdPesaje == change.IdRegistro
                                            select new
                                            {
                                                pesaje.IdAnimal,
                                                AnimalRanchId = animal != null ? (Guid?)animal.IdRancho : null
                                            }).FirstOrDefaultAsync(ct);

                if (weighingAnimal is not null && weighingAnimal.AnimalRanchId != ranchId)
                {
                    return (null, ("REFERENCIA_INEXISTENTE",
                        $"El animal {weighingAnimal.IdAnimal} del pesaje no pertenece al rancho solicitado."));
                }
            }
            else if (string.Equals(change.Entidad, nameof(GenealogiaAnimal), StringComparison.OrdinalIgnoreCase))
            {
                var genealogyAnimal = await (from gen in db.GenealogiasAnimales.AsNoTracking()
                                             join animal in db.Animales.AsNoTracking()
                                                 on gen.IdAnimal equals animal.IdAnimal into animalGroup
                                             from animal in animalGroup.DefaultIfEmpty()
                                             where gen.IdGenealogia == change.IdRegistro
                                             select new
                                             {
                                                 gen.IdAnimal,
                                                 AnimalRanchId = animal != null ? (Guid?)animal.IdRancho : null
                                             }).FirstOrDefaultAsync(ct);

                if (genealogyAnimal is not null && genealogyAnimal.AnimalRanchId != ranchId)
                {
                    return (null, ("REFERENCIA_INEXISTENTE",
                        $"El animal {genealogyAnimal.IdAnimal} de la genealogía no pertenece al rancho solicitado."));
                }
            }
            else if (string.Equals(change.Entidad, nameof(EventoReproductivo), StringComparison.OrdinalIgnoreCase))
            {
                var reproAnimal = await (from er in db.EventosReproductivos.AsNoTracking()
                                         join animal in db.Animales.AsNoTracking()
                                             on er.IdAnimal equals animal.IdAnimal into animalGroup
                                         from animal in animalGroup.DefaultIfEmpty()
                                         where er.IdEventoReproductivo == change.IdRegistro
                                         select new
                                         {
                                             er.IdAnimal,
                                             AnimalRanchId = animal != null ? (Guid?)animal.IdRancho : null
                                         }).FirstOrDefaultAsync(ct);

                if (reproAnimal is not null && reproAnimal.AnimalRanchId != ranchId)
                {
                    return (null, ("REFERENCIA_INEXISTENTE",
                        $"El animal {reproAnimal.IdAnimal} del evento reproductivo no pertenece al rancho solicitado."));
                }
            }
        }
        else
        {
            try
            {
                (JsonElement? mapped, (string Codigo, string Mensaje)? error) =
                    string.Equals(clientEntity, "healthRecords", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(change.Entidad, nameof(Tratamiento), StringComparison.OrdinalIgnoreCase)
                        ? await MapTreatmentDataAsync(change.Datos, ranchId, ct)
                        : string.Equals(clientEntity, "weighings", StringComparison.OrdinalIgnoreCase) ||
                          string.Equals(change.Entidad, nameof(Pesaje), StringComparison.OrdinalIgnoreCase)
                            ? await MapWeighingDataAsync(change.Datos, ranchId, ct)
                            : string.Equals(clientEntity, "genealogy", StringComparison.OrdinalIgnoreCase) ||
                              string.Equals(change.Entidad, nameof(GenealogiaAnimal), StringComparison.OrdinalIgnoreCase)
                                ? await MapGenealogyDataAsync(change.Datos, ranchId, ct)
                                : string.Equals(clientEntity, "reproductionRecords", StringComparison.OrdinalIgnoreCase) ||
                                  string.Equals(change.Entidad, nameof(EventoReproductivo), StringComparison.OrdinalIgnoreCase)
                                    ? await MapReproductionDataAsync(change.Datos, ranchId, ct)
                                    : MapData(clientEntity, change.Datos);
                if (error is not null)
                    return (null, error);
                data = mapped;
            }
            catch (JsonException)
            {
                return (null, ("DATOS_INVALIDOS", "La instantánea del cambio no es JSON válido."));
            }
        }

        return (new CambioPullResponse(
            change.IdRegistro,
            null,
            deleted ? "DELETE" : "UPSERT",
            change.Version,
            data,
            deleted,
            DateTime.SpecifyKind(change.OcurrioEn, DateTimeKind.Utc)), null);
    }

    /// <summary>
    /// Un tratamiento remoto se entrega como registro sanitario local. Requiere que su evento sanitario
    /// exista y pertenezca a un animal del mismo rancho; de lo contrario no se construye un UPSERT
    /// incompleto sino un error REFERENCIA_INEXISTENTE / DATOS_INCOMPLETOS.
    /// </summary>
    private async Task<(JsonElement? Data, (string Codigo, string Mensaje)? Error)> MapTreatmentDataAsync(
        string? rawJson, Guid ranchId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
            return (null, ("DATOS_INCOMPLETOS", "El tratamiento no tiene instantánea de datos."));

        using var document = JsonDocument.Parse(rawJson);
        var source = document.RootElement;
        if (source.ValueKind != JsonValueKind.Object ||
            !TryGetProperty(source, "IdEventoSanitario", out var eventIdValue) ||
            eventIdValue.ValueKind != JsonValueKind.String ||
            !Guid.TryParse(eventIdValue.GetString(), out var eventId) || eventId == Guid.Empty)
            return (null, ("DATOS_INCOMPLETOS", "El tratamiento no indica un idEventoSanitario válido."));

        // Se acepta el evento aunque esté eliminado lógicamente: el historial se conserva.
        var animalId = await (from healthEvent in db.EventosSanitarios.AsNoTracking()
                              join animal in db.Animales.AsNoTracking()
                                  on healthEvent.IdAnimal equals animal.IdAnimal
                              where healthEvent.IdEventoSanitario == eventId &&
                                    animal.IdRancho == ranchId
                              select (Guid?)animal.IdAnimal).FirstOrDefaultAsync(ct);
        if (animalId is null)
            return (null, ("REFERENCIA_INEXISTENTE",
                $"El evento sanitario {eventId} del tratamiento no existe en el rancho solicitado."));

        var producto = TryGetString(source, "Producto") ?? "Tratamiento";
        var dosis = TryGetProperty(source, "Dosis", out var dosisValue)
            ? dosisValue.ToString()
            : string.Empty;
        var unidad = TryGetString(source, "UnidadDosis") ?? string.Empty;
        var fecha = TryGetString(source, "FechaInicio");
        if (string.IsNullOrWhiteSpace(fecha))
            return (null, ("DATOS_INCOMPLETOS", "El tratamiento no tiene fechaInicio."));

        return (JsonSerializer.SerializeToElement(new
        {
            cattleId = animalId.Value,
            ranchId,
            tipo = "Tratamiento",
            descripcion = string.Join(" ", new[] { producto, dosis, unidad }.Where(part => !string.IsNullOrWhiteSpace(part))),
            fecha
        }), null);
    }

    /// <summary>
    /// Valida y proyecta un pesaje remoto para Pull. Verifica que el animal asociado exista y
    /// pertenezca al rancho autorizado, valida peso positivo y fecha, e incluye <c>ranchId</c>
    /// explícitamente para mantener aislamiento por rancho en el cliente offline.
    /// </summary>
    private async Task<(JsonElement? Data, (string Codigo, string Mensaje)? Error)> MapWeighingDataAsync(
        string? rawJson, Guid ranchId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
            return (null, ("DATOS_INCOMPLETOS", "El pesaje no tiene instantánea de datos."));

        using var document = JsonDocument.Parse(rawJson);
        var source = document.RootElement;
        if (source.ValueKind != JsonValueKind.Object)
            return (null, ("DATOS_INVALIDOS", "La instantánea del pesaje debe ser un objeto JSON."));

        var rawAnimalId = TryGetStringAny(source, "IdAnimal", "idAnimal", "cattleId", "animalId");
        if (!Guid.TryParse(rawAnimalId, out var animalId) || animalId == Guid.Empty)
            return (null, ("DATOS_INCOMPLETOS", "El pesaje no indica un idAnimal válido."));

        // Se acepta el animal aunque esté eliminado lógicamente dentro del mismo rancho para preservar historial.
        var animalBelongsToRanch = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdAnimal == animalId && a.IdRancho == ranchId, ct);
        if (!animalBelongsToRanch)
            return (null, ("REFERENCIA_INEXISTENTE",
                $"El animal {animalId} del pesaje no existe en el rancho solicitado."));

        if (!TryGetDecimalAny(source, out var pesoRealKg, "PesoRealKg", "pesoRealKg", "peso"))
            return (null, ("DATOS_INCOMPLETOS", "El pesaje no indica un pesoRealKg válido."));

        if (pesoRealKg <= 0m)
            return (null, ("DATOS_INVALIDOS", "El peso real de báscula (pesoRealKg) debe ser mayor que cero."));

        var fecha = TryGetStringAny(source, "Fecha", "fecha", "date");
        if (string.IsNullOrWhiteSpace(fecha))
            return (null, ("DATOS_INCOMPLETOS", "El pesaje no tiene fecha."));

        var payload = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["ranchId"] = ranchId,
            ["idAnimal"] = animalId,
            ["cattleId"] = animalId,
            ["pesoRealKg"] = pesoRealKg,
            ["peso"] = pesoRealKg,
            ["fecha"] = fecha,
            ["origenPesaje"] = TryGetStringAny(source, "OrigenPesaje", "origenPesaje") ?? "manual"
        };

        var fuenteBascula = TryGetStringAny(source, "FuenteBascula", "fuenteBascula");
        if (!string.IsNullOrWhiteSpace(fuenteBascula))
            payload["fuenteBascula"] = fuenteBascula;

        var responsable = TryGetStringAny(source, "Responsable", "responsable");
        if (!string.IsNullOrWhiteSpace(responsable))
            payload["responsable"] = responsable;

        if (TryGetPropertyAny(source, out var obsProp, "Observaciones", "observaciones"))
        {
            payload["observaciones"] = obsProp.ValueKind == JsonValueKind.Null
                ? null
                : obsProp.ValueKind == JsonValueKind.String
                    ? obsProp.GetString()
                    : obsProp.ToString();
        }

        var createdAt = TryGetStringAny(source, "CreadoEn", "createdAt", "fechaCreacion");
        if (!string.IsNullOrWhiteSpace(createdAt))
            payload["createdAt"] = createdAt;

        return (JsonSerializer.SerializeToElement(payload), null);
    }

    /// <summary>
    /// Valida y proyecta una relación genealógica remota para Pull. Comprueba que el animal y
    /// los progenitores informados pertenezcan al rancho autorizado, rechaza auto-parentesco o
    /// duplicidad padre=madre y conserva valores nulos explícitos al limpiar progenitores u observaciones.
    /// </summary>
    private async Task<(JsonElement? Data, (string Codigo, string Mensaje)? Error)> MapGenealogyDataAsync(
        string? rawJson, Guid ranchId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
            return (null, ("DATOS_INCOMPLETOS", "La genealogía no tiene instantánea de datos."));

        using var document = JsonDocument.Parse(rawJson);
        var source = document.RootElement;
        if (source.ValueKind != JsonValueKind.Object)
            return (null, ("DATOS_INVALIDOS", "La instantánea de genealogía debe ser un objeto JSON."));

        var rawAnimalId = TryGetStringAny(source, "IdAnimal", "idAnimal", "cattleId", "animalId");
        if (!Guid.TryParse(rawAnimalId, out var animalId) || animalId == Guid.Empty)
            return (null, ("DATOS_INCOMPLETOS", "La genealogía no indica un idAnimal válido."));

        var animalBelongsToRanch = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdAnimal == animalId && a.IdRancho == ranchId, ct);
        if (!animalBelongsToRanch)
            return (null, ("REFERENCIA_INEXISTENTE",
                $"El animal {animalId} de la genealogía no existe en el rancho solicitado."));

        Guid? padreId = null;
        var rawPadreId = TryGetStringAny(source, "IdPadre", "idPadre", "padreId", "fatherId");
        if (!string.IsNullOrWhiteSpace(rawPadreId))
        {
            if (!Guid.TryParse(rawPadreId, out var parsedPadre) || parsedPadre == Guid.Empty)
                return (null, ("DATOS_INVALIDOS", "El identificador idPadre de la genealogía no es válido."));
            padreId = parsedPadre;
        }

        Guid? madreId = null;
        var rawMadreId = TryGetStringAny(source, "IdMadre", "idMadre", "madreId", "motherId");
        if (!string.IsNullOrWhiteSpace(rawMadreId))
        {
            if (!Guid.TryParse(rawMadreId, out var parsedMadre) || parsedMadre == Guid.Empty)
                return (null, ("DATOS_INVALIDOS", "El identificador idMadre de la genealogía no es válido."));
            madreId = parsedMadre;
        }

        if (!padreId.HasValue && !madreId.HasValue)
            return (null, ("DATOS_INCOMPLETOS", "La genealogía debe indicar al menos idPadre o idMadre."));

        if (padreId == animalId || madreId == animalId)
            return (null, ("DATOS_INVALIDOS", "Un animal no puede ser su propio padre o madre."));

        if (padreId.HasValue && padreId == madreId)
            return (null, ("DATOS_INVALIDOS", "El padre y la madre no pueden ser el mismo animal."));

        if (padreId is { } pId)
        {
            var padreBelongsToRanch = await db.Animales.AsNoTracking()
                .AnyAsync(a => a.IdAnimal == pId && a.IdRancho == ranchId, ct);
            if (!padreBelongsToRanch)
                return (null, ("REFERENCIA_INEXISTENTE",
                    $"El padre {pId} de la genealogía no existe en el rancho solicitado."));
        }

        if (madreId is { } mId)
        {
            var madreBelongsToRanch = await db.Animales.AsNoTracking()
                .AnyAsync(a => a.IdAnimal == mId && a.IdRancho == ranchId, ct);
            if (!madreBelongsToRanch)
                return (null, ("REFERENCIA_INEXISTENTE",
                    $"La madre {mId} de la genealogía no existe en el rancho solicitado."));
        }

        var payload = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["ranchId"] = ranchId,
            ["idAnimal"] = animalId,
            ["cattleId"] = animalId,
            ["idPadre"] = padreId,
            ["padreId"] = padreId,
            ["idMadre"] = madreId,
            ["madreId"] = madreId
        };

        if (TryGetPropertyAny(source, out var obsProp, "Observaciones", "observaciones"))
        {
            payload["observaciones"] = obsProp.ValueKind == JsonValueKind.Null
                ? null
                : obsProp.ValueKind == JsonValueKind.String
                    ? obsProp.GetString()
                    : obsProp.ToString();
        }
        else
        {
            payload["observaciones"] = null;
        }

        var createdAt = TryGetStringAny(source, "CreadoEn", "createdAt", "fechaCreacion");
        if (!string.IsNullOrWhiteSpace(createdAt))
            payload["createdAt"] = createdAt;

        return (JsonSerializer.SerializeToElement(payload), null);
    }

    private async Task<(JsonElement? Data, (string Codigo, string Mensaje)? Error)> MapReproductionDataAsync(
        string? rawJson, Guid ranchId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
            return (null, ("DATOS_INCOMPLETOS", "El evento reproductivo no tiene instantánea de datos."));

        using var document = JsonDocument.Parse(rawJson);
        var source = document.RootElement;
        if (source.ValueKind != JsonValueKind.Object)
            return (null, ("DATOS_INVALIDOS", "La instantánea del evento reproductivo debe ser un objeto JSON."));

        var rawAnimalId = TryGetStringAny(source, "IdAnimal", "idAnimal", "cattleId", "animalId");
        if (!Guid.TryParse(rawAnimalId, out var animalId) || animalId == Guid.Empty)
            return (null, ("DATOS_INCOMPLETOS", "El evento reproductivo no indica un idAnimal válido."));

        var animalBelongsToRanch = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdAnimal == animalId && a.IdRancho == ranchId, ct);
        if (!animalBelongsToRanch)
            return (null, ("REFERENCIA_INEXISTENTE",
                $"El animal {animalId} del evento reproductivo no existe en el rancho solicitado."));

        Guid? sementalId = null;
        var rawSementalId = TryGetStringAny(source, "IdSemental", "idSemental", "sireId");
        if (!string.IsNullOrWhiteSpace(rawSementalId))
        {
            if (!Guid.TryParse(rawSementalId, out var parsedSemental) || parsedSemental == Guid.Empty)
                return (null, ("DATOS_INVALIDOS", "El identificador idSemental no es válido."));
            var sementalBelongs = await db.Animales.AsNoTracking()
                .AnyAsync(a => a.IdAnimal == parsedSemental && a.IdRancho == ranchId, ct);
            if (!sementalBelongs)
                return (null, ("REFERENCIA_INEXISTENTE",
                    $"El semental {parsedSemental} del evento reproductivo no existe en el rancho solicitado."));
            sementalId = parsedSemental;
        }

        var tipo = TryGetStringAny(source, "Tipo", "tipo", "evento", "event");
        if (string.IsNullOrWhiteSpace(tipo))
            return (null, ("DATOS_INCOMPLETOS", "El evento reproductivo no indica tipo."));

        var fecha = TryGetStringAny(source, "Fecha", "fecha", "date");
        if (string.IsNullOrWhiteSpace(fecha))
            return (null, ("DATOS_INCOMPLETOS", "El evento reproductivo no indica fecha."));

        var payload = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["ranchId"] = ranchId,
            ["idAnimal"] = animalId,
            ["cattleId"] = animalId,
            ["idSemental"] = sementalId,
            ["tipo"] = tipo,
            ["evento"] = tipo,
            ["fecha"] = fecha
        };

        payload["resultado"] = TryGetPropertyAny(source, out var resProp, "Resultado", "resultado") &&
                               resProp.ValueKind != JsonValueKind.Null
            ? (resProp.ValueKind == JsonValueKind.String ? resProp.GetString() : resProp.ToString())
            : null;

        payload["observaciones"] = TryGetPropertyAny(source, out var obsProp, "Observaciones", "observaciones") &&
                                   obsProp.ValueKind != JsonValueKind.Null
            ? (obsProp.ValueKind == JsonValueKind.String ? obsProp.GetString() : obsProp.ToString())
            : null;

        var createdAt = TryGetStringAny(source, "CreadoEn", "createdAt", "fechaCreacion");
        if (!string.IsNullOrWhiteSpace(createdAt))
            payload["createdAt"] = createdAt;

        return (JsonSerializer.SerializeToElement(payload), null);
    }

    private static (JsonElement? Data, (string Codigo, string Mensaje)? Error) MapData(string clientEntity, string? rawJson)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
            return (null, ("DATOS_INCOMPLETOS", "El cambio UPSERT no tiene instantánea de datos."));

        using var document = JsonDocument.Parse(rawJson);
        var source = document.RootElement;
        if (source.ValueKind != JsonValueKind.Object)
            return (null, ("DATOS_INVALIDOS", "La instantánea del cambio debe ser un objeto JSON."));

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

        return (JsonSerializer.SerializeToElement(data), null);
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

    private static bool TryGetPropertyAny(JsonElement source, out JsonElement value, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGetProperty(source, name, out value))
                return true;
        }
        value = default;
        return false;
    }

    private static string? TryGetStringAny(JsonElement source, params string[] names)
    {
        foreach (var name in names)
        {
            var value = TryGetString(source, name);
            if (!string.IsNullOrWhiteSpace(value))
                return value;
        }
        return null;
    }

    private static bool TryGetDecimalAny(JsonElement source, out decimal result, params string[] names)
    {
        foreach (var name in names)
        {
            if (!TryGetProperty(source, name, out var prop))
                continue;
            if (prop.ValueKind == JsonValueKind.Number && prop.TryGetDecimal(out result))
                return true;
            if (prop.ValueKind == JsonValueKind.String &&
                decimal.TryParse(prop.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out result))
                return true;
        }
        result = 0m;
        return false;
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
