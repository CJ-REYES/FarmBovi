using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Reflection;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

public sealed record OperacionSyncRequest(
    Guid IdOperacion,
    Guid IdRancho,
    [Required, StringLength(120, MinimumLength = 1)] string IdDispositivo,
    [Required, StringLength(80, MinimumLength = 1)] string Entidad,
    Guid IdRegistro,
    [Required, StringLength(20, MinimumLength = 1)] string Operacion,
    long? VersionBase,
    JsonElement Datos);

public sealed record OperacionSyncResponse(
    Guid IdOperacion,
    string Entidad,
    Guid IdRegistro,
    string Operacion,
    long Version,
    Guid IdCambio,
    DateTime OcurrioEn,
    bool DuplicadoIgnorado,
    JsonElement? Datos);

[ApiController]
[Route("api/sync/operaciones")]
[Authorize]
public sealed class SyncPushController(FarmDbContext db, FarmDomainValidationService validator) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [HttpPost]
    public async Task<ActionResult<OperacionSyncResponse>> Push(OperacionSyncRequest request, CancellationToken ct)
    {
        if (request.IdOperacion == Guid.Empty || request.IdRancho == Guid.Empty || request.IdRegistro == Guid.Empty)
            return BadRequest(new { mensaje = "idOperacion, idRancho e idRegistro son obligatorios." });
        if (string.IsNullOrWhiteSpace(request.IdDispositivo) || string.IsNullOrWhiteSpace(request.Entidad))
            return BadRequest(new { mensaje = "idDispositivo y entidad son obligatorios." });

        var userText = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(userText, out var userId) || userId == Guid.Empty) return Unauthorized();

        var hasAccess = await (from ur in db.UsuarioRanchos.AsNoTracking()
                               join u in db.Usuarios.AsNoTracking() on ur.IdUsuario equals u.IdUsuario
                               join r in db.Ranchos.AsNoTracking() on ur.IdRancho equals r.IdRancho
                               where ur.IdUsuario == userId && ur.IdRancho == request.IdRancho &&
                                     ur.Estado.ToLower() == "activo" && ur.FechaBaja == null &&
                                     u.Estado.ToLower() == "activo" && r.EliminadoEn == null
                               select ur.IdUsuarioRancho).AnyAsync(ct);
        if (!hasAccess) return Forbid();

        var entityName = NormalizeEntity(request.Entidad);
        if (entityName is null)
            return BadRequest(new { mensaje = "La entidad no está habilitada para sincronización." });
        var operation = NormalizeOperation(request.Operacion);
        if (operation is null)
            return BadRequest(new { mensaje = "operacion debe ser Crear, Actualizar o Eliminar." });

        if (operation == "Crear" && request.Datos.ValueKind != JsonValueKind.Object)
            return BadRequest(new { mensaje = "datos debe ser un objeto JSON para Crear." });
        if (operation != "Crear" && (!request.VersionBase.HasValue || request.VersionBase.Value < 1))
            return BadRequest(new { mensaje = "versionBase >= 1 es obligatoria para Actualizar o Eliminar." });

        var requestHash = HashRequest(request, entityName, operation);
        var previous = await db.RegistrosOperacionSync.AsNoTracking()
            .SingleOrDefaultAsync(x => x.IdOperacion == request.IdOperacion, ct);
        if (previous is not null) return ReturnDuplicate(previous, requestHash, userId, request.IdRancho);

        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        try
        {
            // Recheck after entering the transaction to make concurrent retries idempotent.
            previous = await db.RegistrosOperacionSync.AsNoTracking()
                .SingleOrDefaultAsync(x => x.IdOperacion == request.IdOperacion, ct);
            if (previous is not null)
            {
                if (transaction is not null) await transaction.RollbackAsync(ct);
                return ReturnDuplicate(previous, requestHash, userId, request.IdRancho);
            }

            object? entity;
            if (operation == "Crear")
            {
                entity = DeserializeEntity(entityName, request.Datos);
                PrepareForCreate(entity, request.IdRegistro, request.IdRancho, userId);
                var ranchId = await ResolveRanchIdAsync(entity, ct);
                if (ranchId != request.IdRancho) return Forbid();
                var validationError = await ValidateEntityAsync(entity, excludeId: null, ct);
                if (validationError is not null) return BadRequest(new { mensaje = validationError });
                db.Add(entity);
            }
            else
            {
                entity = await FindEntityAsync(entityName, request.IdRegistro, ct);
                if (entity is null) return NotFound(new { mensaje = "No existe el registro solicitado." });

                var entityRanchId = await ResolveRanchIdAsync(entity, ct);
                if (entityRanchId != request.IdRancho) return Forbid();
                var serverVersion = GetVersion(entity);
                if (IsDeleted(entity) || serverVersion != request.VersionBase)
                {
                    return Conflict(new
                    {
                        tipoConflicto = IsDeleted(entity) ? "EliminadoEnServidor" : "VersionDistinta",
                        idOperacion = request.IdOperacion,
                        entidad = entityName,
                        idRegistro = request.IdRegistro,
                        versionBase = request.VersionBase,
                        versionServidor = serverVersion,
                        datosServidor = JsonSerializer.SerializeToElement(entity, entity.GetType(), JsonOptions)
                    });
                }

                if (operation == "Actualizar")
                {
                    if (request.Datos.ValueKind != JsonValueKind.Object)
                        return BadRequest(new { mensaje = "datos debe ser un objeto JSON para Actualizar." });
                    var applyError = ApplyUpdate(entity, request.Datos);
                    if (applyError is not null) return BadRequest(new { mensaje = applyError });
                    if (await ResolveRanchIdAsync(entity, ct) != request.IdRancho) return Forbid();
                    var validationError = await ValidateEntityAsync(entity, request.IdRegistro, ct);
                    if (validationError is not null) return BadRequest(new { mensaje = validationError });
                }
                else
                {
                    SetDeleted(entity, DateTime.UtcNow);
                }

                SetVersion(entity, checked(serverVersion + 1));
            }

            await db.SaveChangesAsync(ct); // The context records CambioServidor in this same transaction.
            var version = GetVersion(entity);
            var change = await db.CambiosServidor.AsNoTracking()
                .Where(c => c.IdRancho == request.IdRancho && c.Entidad == entityName &&
                            c.IdRegistro == request.IdRegistro && c.Version == version)
                .OrderByDescending(c => c.OcurrioEn).FirstOrDefaultAsync(ct);
            if (change is null)
                throw new InvalidOperationException("SaveChanges no generó el CambioServidor esperado.");

            var response = new OperacionSyncResponse(
                request.IdOperacion, entityName, request.IdRegistro, operation, version,
                change.IdCambio, DateTime.SpecifyKind(change.OcurrioEn, DateTimeKind.Utc), false,
                operation == "Eliminar" ? null : JsonSerializer.SerializeToElement(entity, entity.GetType(), JsonOptions));
            db.RegistrosOperacionSync.Add(new RegistroOperacionSync
            {
                IdOperacion = request.IdOperacion,
                IdUsuario = userId,
                IdRancho = request.IdRancho,
                IdDispositivo = request.IdDispositivo.Trim(),
                HashSolicitud = requestHash,
                ResultadoJson = JsonSerializer.Serialize(response, JsonOptions),
                ProcesadoEn = DateTime.UtcNow
            });
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
            return operation == "Crear" ? Created($"/api/sync/operaciones/{request.IdOperacion}", response) : Ok(response);
        }
        catch (DbUpdateException)
        {
            if (transaction is not null) await transaction.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            var committed = await db.RegistrosOperacionSync.AsNoTracking()
                .SingleOrDefaultAsync(x => x.IdOperacion == request.IdOperacion, ct);
            if (committed is not null) return ReturnDuplicate(committed, requestHash, userId, request.IdRancho);
            return Conflict(new { mensaje = "La operación entró en conflicto con un cambio concurrente." });
        }
    }

    private ActionResult<OperacionSyncResponse> ReturnDuplicate(
        RegistroOperacionSync previous, string requestHash, Guid userId, Guid ranchId)
    {
        if (previous.IdUsuario != userId || previous.IdRancho != ranchId ||
            !CryptographicOperations.FixedTimeEquals(Convert.FromHexString(previous.HashSolicitud), Convert.FromHexString(requestHash)))
            return Conflict(new { mensaje = "idOperacion ya fue utilizada con otra solicitud." });
        var response = JsonSerializer.Deserialize<OperacionSyncResponse>(previous.ResultadoJson, JsonOptions);
        return response is null
            ? Conflict(new { mensaje = "No se pudo recuperar la respuesta idempotente." })
            : Ok(response with { DuplicadoIgnorado = true });
    }

    private async Task<string?> ValidateEntityAsync(object entity, Guid? excludeId, CancellationToken ct)
    {
        switch (entity)
        {
            case Animal animal:
                return await validator.ValidateAnimalAsync(animal, excludeId, ct);
            case Lote lote:
                if (lote.IdRancho == Guid.Empty || string.IsNullOrWhiteSpace(lote.Nombre) || string.IsNullOrWhiteSpace(lote.Estado))
                    return "IdRancho, nombre y estado del lote son obligatorios.";
                return await db.Ranchos.AsNoTracking().AnyAsync(r => r.IdRancho == lote.IdRancho && r.EliminadoEn == null, ct)
                    ? null : "El rancho del lote no existe o está eliminado.";
            case EventoSanitario evento:
                return await validator.ValidateEventoSanitarioAsync(evento, ct);
            case Tratamiento tratamiento:
                return await validator.ValidateTratamientoAsync(tratamiento, ct);
            case Recordatorio recordatorio:
                return await validator.ValidateRecordatorioAsync(recordatorio, ct);
            case Alimentacion alimentacion:
                return await validator.ValidateAlimentacionAsync(alimentacion.IdAnimal, alimentacion.IdLote,
                    alimentacion.Cantidad, alimentacion.Inicio, alimentacion.Fin, ct);
            case MovimientoAnimal movimiento:
                var (_, error) = await validator.ValidateAndPrepareMovimientoAsync(movimiento, ct);
                return error;
            default:
                return "Entidad no soportada.";
        }
    }

    private async Task<Guid?> ResolveRanchIdAsync(object entity, CancellationToken ct)
    {
        switch (entity)
        {
            case Animal x: return x.IdRancho;
            case Lote x: return x.IdRancho;
            case Recordatorio x: return x.IdRancho;
            case EventoSanitario x:
                return await db.Animales.AsNoTracking().Where(a => a.IdAnimal == x.IdAnimal)
                    .Select(a => (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            case Tratamiento x:
                return await (from t in db.Tratamientos.AsNoTracking()
                              join ev in db.EventosSanitarios.AsNoTracking() on t.IdEventoSanitario equals ev.IdEventoSanitario
                              join a in db.Animales.AsNoTracking() on ev.IdAnimal equals a.IdAnimal
                              where t.IdTratamiento == x.IdTratamiento
                              select (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            case Alimentacion x when x.IdAnimal.HasValue:
                return await db.Animales.AsNoTracking().Where(a => a.IdAnimal == x.IdAnimal.Value)
                    .Select(a => (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            case Alimentacion x when x.IdLote.HasValue:
                return await db.Lotes.AsNoTracking().Where(l => l.IdLote == x.IdLote.Value)
                    .Select(l => (Guid?)l.IdRancho).FirstOrDefaultAsync(ct);
            case MovimientoAnimal x:
                return await db.Animales.AsNoTracking().Where(a => a.IdAnimal == x.IdAnimal)
                    .Select(a => (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            default: return null;
        }
    }

    private async Task<object?> FindEntityAsync(string entityName, Guid id, CancellationToken ct) => entityName switch
    {
        nameof(Animal) => await db.Animales.SingleOrDefaultAsync(x => x.IdAnimal == id, ct),
        nameof(Lote) => await db.Lotes.SingleOrDefaultAsync(x => x.IdLote == id, ct),
        nameof(EventoSanitario) => await db.EventosSanitarios.SingleOrDefaultAsync(x => x.IdEventoSanitario == id, ct),
        nameof(Tratamiento) => await db.Tratamientos.SingleOrDefaultAsync(x => x.IdTratamiento == id, ct),
        nameof(Recordatorio) => await db.Recordatorios.SingleOrDefaultAsync(x => x.IdRecordatorio == id, ct),
        nameof(Alimentacion) => await db.Alimentaciones.SingleOrDefaultAsync(x => x.IdAlimentacion == id, ct),
        nameof(MovimientoAnimal) => await db.MovimientosAnimales.SingleOrDefaultAsync(x => x.IdMovimiento == id, ct),
        _ => null
    };

    private static object DeserializeEntity(string entityName, JsonElement data)
    {
        var json = data.GetRawText();
        return entityName switch
        {
            nameof(Animal) => JsonSerializer.Deserialize<Animal>(json, JsonOptions)!,
            nameof(Lote) => JsonSerializer.Deserialize<Lote>(json, JsonOptions)!,
            nameof(EventoSanitario) => JsonSerializer.Deserialize<EventoSanitario>(json, JsonOptions)!,
            nameof(Tratamiento) => JsonSerializer.Deserialize<Tratamiento>(json, JsonOptions)!,
            nameof(Recordatorio) => JsonSerializer.Deserialize<Recordatorio>(json, JsonOptions)!,
            nameof(Alimentacion) => JsonSerializer.Deserialize<Alimentacion>(json, JsonOptions)!,
            nameof(MovimientoAnimal) => JsonSerializer.Deserialize<MovimientoAnimal>(json, JsonOptions)!,
            _ => throw new JsonException("Entidad no soportada.")
        };
    }

    private static void PrepareForCreate(object entity, Guid id, Guid ranchId, Guid userId)
    {
        SetId(entity, id);
        SetIfExists(entity, "IdRancho", ranchId);
        SetIfExists(entity, "IdAutor", userId);
        SetIfExists(entity, "VersionRegistro", 1L);
        SetIfExists(entity, "CreadoEn", DateTime.UtcNow);
        SetIfExists(entity, "FechaCreacion", DateTime.UtcNow);
        SetIfDefaultDate(entity, "FechaIngreso");
        SetIfDefaultDate(entity, "Fecha");
        SetIfDefaultDate(entity, "FechaInicio");
        SetIfDefaultDate(entity, "Inicio");
        SetIfDefaultDate(entity, "FechaProgramada");
        SetIfExists(entity, "EliminadoEn", null);
    }

    private static string? ApplyUpdate(object entity, JsonElement data)
    {
        var type = entity.GetType();
        var props = type.GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(p => p.CanWrite).ToDictionary(p => p.Name, p => p, StringComparer.OrdinalIgnoreCase);
        var protectedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "VersionRegistro", "CreadoEn", "FechaCreacion", "EliminadoEn", "IdAutor", "IdRancho",
            "IdAnimal", "IdLote", "IdEventoSanitario", "IdTratamiento", "IdRecordatorio", "IdAlimentacion", "IdMovimiento"
        };
        foreach (var property in data.EnumerateObject())
        {
            if (protectedNames.Contains(property.Name)) continue;
            if (!props.TryGetValue(property.Name, out var target))
                return $"El campo '{property.Name}' no existe en {type.Name}.";
            try
            {
                var value = JsonSerializer.Deserialize(property.Value.GetRawText(), target.PropertyType, JsonOptions);
                target.SetValue(entity, value);
            }
            catch (JsonException)
            {
                return $"El valor del campo '{property.Name}' no es válido.";
            }
        }
        return null;
    }

    private static Guid GetId(object entity) => entity switch
    {
        Animal x => x.IdAnimal,
        Lote x => x.IdLote,
        EventoSanitario x => x.IdEventoSanitario,
        Tratamiento x => x.IdTratamiento,
        Recordatorio x => x.IdRecordatorio,
        Alimentacion x => x.IdAlimentacion,
        MovimientoAnimal x => x.IdMovimiento,
        _ => Guid.Empty
    };

    private static long GetVersion(object entity) => entity switch
    {
        Animal x => x.VersionRegistro,
        Lote x => x.VersionRegistro,
        EventoSanitario x => x.VersionRegistro,
        Tratamiento x => x.VersionRegistro,
        Recordatorio x => x.VersionRegistro,
        Alimentacion x => x.VersionRegistro,
        MovimientoAnimal x => x.VersionRegistro,
        _ => 0
    };

    private static void SetId(object entity, Guid id)
    {
        var name = entity switch
        {
            Animal => "IdAnimal", Lote => "IdLote", EventoSanitario => "IdEventoSanitario",
            Tratamiento => "IdTratamiento", Recordatorio => "IdRecordatorio",
            Alimentacion => "IdAlimentacion", MovimientoAnimal => "IdMovimiento", _ => string.Empty
        };
        SetIfExists(entity, name, id);
    }

    private static bool IsDeleted(object entity) => GetProperty(entity, "EliminadoEn") is DateTime;
    private static void SetDeleted(object entity, DateTime value) => SetIfExists(entity, "EliminadoEn", value);
    private static void SetVersion(object entity, long value) => SetIfExists(entity, "VersionRegistro", value);
    private static object? GetProperty(object entity, string name) => entity.GetType().GetProperty(name)?.GetValue(entity);
    private static void SetIfDefaultDate(object entity, string name)
    {
        var value = GetProperty(entity, name);
        if (value is DateTime date && date == default) SetIfExists(entity, name, DateTime.UtcNow);
    }
    private static void SetIfExists(object entity, string name, object? value)
    {
        if (string.IsNullOrEmpty(name)) return;
        var property = entity.GetType().GetProperty(name);
        if (property?.CanWrite == true) property.SetValue(entity, value);
    }

    private static string? NormalizeEntity(string value) => value.Trim().ToLowerInvariant() switch
    {
        "animal" or "animales" => nameof(Animal),
        "lote" or "lotes" => nameof(Lote),
        "eventosanitario" or "eventos-sanitarios" => nameof(EventoSanitario),
        "tratamiento" or "tratamientos" => nameof(Tratamiento),
        "recordatorio" or "recordatorios" => nameof(Recordatorio),
        "alimentacion" or "alimentaciones" => nameof(Alimentacion),
        "movimientoanimal" or "movimientos-animales" => nameof(MovimientoAnimal),
        _ => null
    };

    private static string? NormalizeOperation(string value) => value.Trim().ToLowerInvariant() switch
    {
        "crear" or "create" or "alta" => "Crear",
        "actualizar" or "update" or "modificar" => "Actualizar",
        "eliminar" or "delete" or "baja" => "Eliminar",
        _ => null
    };

    private static string HashRequest(OperacionSyncRequest request, string entityName, string operation)
    {
        var data = request.Datos.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? "null"
            : request.Datos.GetRawText();
        var canonical = string.Join('|', request.IdOperacion, request.IdRancho, request.IdDispositivo.Trim(),
            entityName, request.IdRegistro, operation, request.VersionBase?.ToString() ?? "", data);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }
}
