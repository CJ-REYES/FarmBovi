using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/sync")]
public sealed class SincronizacionController(FarmDbContext db) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    [HttpPost("operaciones")]
    public async Task<IActionResult> RecibirOperacion([FromBody] OperacionSyncRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.IdOperacion))
            return BadRequest("El identificador de operación (idOperacion) es obligatorio.");

        var idOperacion = request.IdOperacion.Trim();
        var entidadNormalizada = NormalizeEntityName(request.Entidad);
        if (entidadNormalizada is null)
            return BadRequest($"La entidad '{request.Entidad}' no está soportada para sincronización.");

        var accionNormalizada = NormalizeAction(request.Accion);
        if (accionNormalizada is null)
            return BadRequest($"La acción '{request.Accion}' no es válida. Usa CREATE, UPDATE o DELETE.");

        var hashSolicitud = ComputeRequestHash(request, entidadNormalizada, accionNormalizada);

        // 3. Evitar registros duplicados (Idempotencia por IdOperacion)
        var existente = await db.RegistrosSyncServidor.AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdOperacion == idOperacion, ct);

        if (existente is not null)
        {
            if (!string.Equals(existente.HashSolicitud, hashSolicitud, StringComparison.OrdinalIgnoreCase))
            {
                return Conflict(new
                {
                    tipoConflicto = "IDEMPOTENCY_HASH_MISMATCH",
                    mensaje = "El idOperacion ya fue registrado previamente con datos distintos.",
                    idOperacion
                });
            }

            using var docExistente = JsonDocument.Parse(existente.Resultado);
            var respuestaPrevia = new OperacionSyncResponse(
                existente.IdOperacion,
                existente.Entidad,
                existente.IdRegistro,
                accionNormalizada,
                existente.VersionResultante,
                DuplicadoIgnorado: true,
                existente.AplicadoEn,
                docExistente.RootElement.Clone());

            return Ok(respuestaPrevia);
        }

        // Procesar según la acción
        if (accionNormalizada == "CREATE")
        {
            return await ProcesarCreacionAsync(request, idOperacion, entidadNormalizada, hashSolicitud, ct);
        }

        return await ProcesarModificacionOEliminacionAsync(
            request, idOperacion, entidadNormalizada, accionNormalizada, hashSolicitud, ct);
    }

    [HttpGet("operaciones/{idOperacion}")]
    public async Task<ActionResult<RegistroSyncServidor>> ObtenerOperacion(string idOperacion, CancellationToken ct) =>
        await db.RegistrosSyncServidor.AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdOperacion == idOperacion, ct) is { } item
            ? Ok(item)
            : NotFound();

    [HttpGet("cambios")]
    public async Task<ActionResult<List<CambioServidor>>> ObtenerCambiosRemotos(
        [FromQuery] int? idRancho,
        [FromQuery] long desdeId = 0,
        [FromQuery] int limite = 100,
        CancellationToken ct = default)
    {
        if (limite is < 1 or > 500) return BadRequest("El límite debe estar entre 1 y 500.");

        var query = db.CambiosServidor.AsNoTracking()
            .Where(c => c.IdCambioRemoto > desdeId);

        if (idRancho.HasValue)
            query = query.Where(c => c.IdRancho == idRancho.Value);

        var items = await query
            .OrderBy(c => c.IdCambioRemoto)
            .Take(limite)
            .ToListAsync(ct);

        return Ok(items);
    }

    [HttpGet("auditoria")]
    public async Task<ActionResult<List<CambioAuditoria>>> ObtenerAuditoria(
        [FromQuery] int? idRancho,
        [FromQuery] string? entidad,
        [FromQuery] int limite = 100,
        CancellationToken ct = default)
    {
        if (limite is < 1 or > 500) return BadRequest("El límite debe estar entre 1 y 500.");

        var query = db.CambiosAuditoria.AsNoTracking().AsQueryable();

        if (idRancho.HasValue)
            query = query.Where(a => a.IdRancho == idRancho.Value);

        if (!string.IsNullOrWhiteSpace(entidad))
        {
            var norm = NormalizeEntityName(entidad) ?? entidad.Trim();
            query = query.Where(a => a.Entidad == norm);
        }

        var items = await query
            .OrderByDescending(a => a.Fecha)
            .Take(limite)
            .ToListAsync(ct);

        return Ok(items);
    }

    private async Task<IActionResult> ProcesarCreacionAsync(
        OperacionSyncRequest request,
        string idOperacion,
        string entidadNormalizada,
        string hashSolicitud,
        CancellationToken ct)
    {
        if (request.Datos.ValueKind != JsonValueKind.Object)
            return BadRequest("Los datos enviados (datos) deben ser un objeto JSON válido para CREATE.");

        object entidadNueva;
        try
        {
            entidadNueva = DeserializeEntity(entidadNormalizada, request.Datos);
        }
        catch (JsonException ex)
        {
            return BadRequest($"Los datos enviados no coinciden con el esquema de {entidadNormalizada}: {ex.Message}");
        }

        var ahora = DateTime.UtcNow;
        PrepareEntityForCreate(entidadNormalizada, entidadNueva, request, ahora);

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        db.Add(entidadNueva);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return Conflict(new
            {
                tipoConflicto = "DUPLICATE_OR_INVALID_REFERENCE",
                mensaje = "No se pudo crear el registro por restricción de unicidad o clave foránea.",
                idOperacion
            });
        }

        var idRegistro = GetEntityPrimaryKeyString(entidadNormalizada, entidadNueva);
        var versionResultante = GetEntityVersion(entidadNueva);
        var despuesJson = JsonSerializer.Serialize(entidadNueva, entidadNueva.GetType(), JsonOptions);

        RegistrarTrazabilidadSync(
            idOperacion,
            request,
            entidadNormalizada,
            idRegistro,
            "CREATE",
            hashSolicitud,
            versionResultante,
            antesJson: null,
            despuesJson,
            ahora);

        await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);

        using var doc = JsonDocument.Parse(despuesJson);
        return CreatedAtAction(
            nameof(ObtenerOperacion),
            new { idOperacion },
            new OperacionSyncResponse(
                idOperacion,
                entidadNormalizada,
                idRegistro,
                "CREATE",
                versionResultante,
                DuplicadoIgnorado: false,
                ahora,
                doc.RootElement.Clone()));
    }

    private async Task<IActionResult> ProcesarModificacionOEliminacionAsync(
        OperacionSyncRequest request,
        string idOperacion,
        string entidadNormalizada,
        string accionNormalizada,
        string hashSolicitud,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.IdRegistro))
            return BadRequest($"El campo idRegistro es obligatorio para la acción {accionNormalizada}.");

        if (!request.VersionBase.HasValue || request.VersionBase.Value < 1)
            return BadRequest("Debe enviar la versión del registro (versionBase >= 1) para validar concurrencia.");

        var idRegistro = request.IdRegistro.Trim();
        var existente = await FindEntityByIdAsync(entidadNormalizada, idRegistro, ct);
        if (existente is null)
            return NotFound($"No se encontró el registro '{idRegistro}' en la entidad '{entidadNormalizada}'.");

        var versionServidor = GetEntityVersion(existente);
        var eliminadoEnServidor = GetEntityDeletedAt(existente);
        var antesJson = JsonSerializer.Serialize(existente, existente.GetType(), JsonOptions);
        using var docServidor = JsonDocument.Parse(antesJson);

        // 4 y 5. Validar versiones de los registros y responder cuando exista un conflicto
        if (eliminadoEnServidor.HasValue)
        {
            var camposEliminado = CalcularCamposModificados(docServidor.RootElement, request.Datos);
            return Conflict(new ConflictoSyncResponse(
                TipoConflicto: "DELETED_ON_SERVER",
                Mensaje: "El registro ya fue eliminado previamente en el servidor por otro dispositivo.",
                IdOperacion: idOperacion,
                Entidad: entidadNormalizada,
                IdRegistro: idRegistro,
                VersionEnviada: request.VersionBase,
                VersionServidor: versionServidor,
                CamposModificados: camposEliminado,
                EstadoServidor: docServidor.RootElement.Clone()));
        }

        if (request.VersionBase.Value != versionServidor)
        {
            var camposModificados = CalcularCamposModificados(docServidor.RootElement, request.Datos);
            return Conflict(new ConflictoSyncResponse(
                TipoConflicto: "VERSION_MISMATCH",
                Mensaje: $"Conflicto de versión: el dispositivo envió la versión {request.VersionBase.Value}, pero la versión actual en el servidor es {versionServidor}.",
                IdOperacion: idOperacion,
                Entidad: entidadNormalizada,
                IdRegistro: idRegistro,
                VersionEnviada: request.VersionBase,
                VersionServidor: versionServidor,
                CamposModificados: camposModificados,
                EstadoServidor: docServidor.RootElement.Clone()));
        }

        var ahora = DateTime.UtcNow;
        if (accionNormalizada == "UPDATE")
        {
            if (request.Datos.ValueKind != JsonValueKind.Object)
                return BadRequest("Los datos enviados (datos) deben ser un objeto JSON válido para UPDATE.");

            ApplyPartialUpdate(existente, request.Datos);
        }
        else // DELETE lógico conservando trazabilidad (Regla 08 y 36)
        {
            SetEntityDeletedAt(existente, ahora);
        }

        var versionResultante = versionServidor + 1;
        SetEntityVersion(existente, versionResultante);

        var despuesJson = JsonSerializer.Serialize(existente, existente.GetType(), JsonOptions);

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        RegistrarTrazabilidadSync(
            idOperacion,
            request,
            entidadNormalizada,
            idRegistro,
            accionNormalizada,
            hashSolicitud,
            versionResultante,
            antesJson,
            despuesJson,
            ahora);

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return Conflict(new
            {
                tipoConflicto = "CONSTRAINT_VIOLATION",
                mensaje = "No se pudo aplicar el cambio por una restricción de integridad en la base de datos.",
                idOperacion
            });
        }

        using var docDespues = JsonDocument.Parse(despuesJson);
        return Ok(new OperacionSyncResponse(
            idOperacion,
            entidadNormalizada,
            idRegistro,
            accionNormalizada,
            versionResultante,
            DuplicadoIgnorado: false,
            ahora,
            docDespues.RootElement.Clone()));
    }

    private void RegistrarTrazabilidadSync(
        string idOperacion,
        OperacionSyncRequest request,
        string entidadNormalizada,
        string idRegistro,
        string accionNormalizada,
        string hashSolicitud,
        long versionResultante,
        string? antesJson,
        string despuesJson,
        DateTime ahora)
    {
        var dispositivo = string.IsNullOrWhiteSpace(request.IdDispositivo)
            ? "dispositivo-movil"
            : request.IdDispositivo.Trim();

        db.RegistrosSyncServidor.Add(new RegistroSyncServidor
        {
            IdOperacion = idOperacion,
            IdUsuario = request.IdUsuario,
            IdRancho = request.IdRancho,
            IdDispositivo = dispositivo,
            HashSolicitud = hashSolicitud,
            Entidad = entidadNormalizada,
            IdRegistro = idRegistro,
            Resultado = despuesJson,
            VersionResultante = versionResultante,
            AplicadoEn = ahora
        });

        db.CambiosServidor.Add(new CambioServidor
        {
            IdRancho = request.IdRancho,
            IdOperacion = idOperacion,
            Entidad = entidadNormalizada,
            IdRegistro = idRegistro,
            Accion = accionNormalizada,
            VersionRegistro = versionResultante,
            DatosJson = despuesJson,
            FechaCambio = ahora
        });

        db.CambiosAuditoria.Add(new CambioAuditoria
        {
            IdCambio = Guid.NewGuid().ToString(),
            IdRancho = request.IdRancho,
            IdUsuario = request.IdUsuario,
            IdOperacion = idOperacion,
            Entidad = entidadNormalizada,
            IdRegistro = idRegistro,
            Accion = accionNormalizada,
            Fecha = ahora,
            Origen = "SYNC_MOVIL",
            Antes = antesJson,
            Despues = despuesJson
        });
    }

    private static IReadOnlyList<CampoConflictoDto> CalcularCamposModificados(
        JsonElement estadoServidor,
        JsonElement datosCliente)
    {
        var diferencias = new List<CampoConflictoDto>();
        if (estadoServidor.ValueKind != JsonValueKind.Object || datosCliente.ValueKind != JsonValueKind.Object)
            return diferencias;

        var propsServidor = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        foreach (var prop in estadoServidor.EnumerateObject())
        {
            propsServidor[prop.Name] = prop.Value;
        }

        foreach (var propCliente in datosCliente.EnumerateObject())
        {
            if (IsMetadataProperty(propCliente.Name)) continue;

            if (propsServidor.TryGetValue(propCliente.Name, out var valorServidor))
            {
                if (!JsonElementsEqual(valorServidor, propCliente.Value))
                {
                    diferencias.Add(new CampoConflictoDto(
                        propCliente.Name,
                        valorServidor.Clone(),
                        propCliente.Value.Clone()));
                }
            }
        }

        return diferencias;
    }

    private static bool JsonElementsEqual(JsonElement a, JsonElement b)
    {
        if (a.ValueKind != b.ValueKind)
            return string.Equals(a.ToString(), b.ToString(), StringComparison.Ordinal);

        return a.ValueKind switch
        {
            JsonValueKind.String => string.Equals(a.GetString(), b.GetString(), StringComparison.Ordinal),
            JsonValueKind.Number => a.GetDecimal() == b.GetDecimal(),
            JsonValueKind.True or JsonValueKind.False => a.GetBoolean() == b.GetBoolean(),
            JsonValueKind.Null => true,
            _ => string.Equals(a.GetRawText(), b.GetRawText(), StringComparison.Ordinal)
        };
    }

    private static bool IsMetadataProperty(string name) =>
        name.Equals("versionRegistro", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("creadoEn", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("fechaCreacion", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idAnimal", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idLote", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idRancho", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idEventoSanitario", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idTratamiento", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idRecordatorio", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idAlimentacion", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idMovimiento", StringComparison.OrdinalIgnoreCase);

    private static void ApplyPartialUpdate(object entity, JsonElement datos)
    {
        var type = entity.GetType();
        var props = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.CanWrite)
            .ToDictionary(p => p.Name, p => p, StringComparer.OrdinalIgnoreCase);

        foreach (var jsonProp in datos.EnumerateObject())
        {
            if (IsPrimaryKeyOrVersionProperty(type.Name, jsonProp.Name)) continue;
            if (!props.TryGetValue(jsonProp.Name, out var propInfo)) continue;

            var value = JsonSerializer.Deserialize(jsonProp.Value.GetRawText(), propInfo.PropertyType, JsonOptions);
            propInfo.SetValue(entity, value);
        }
    }

    private static bool IsPrimaryKeyOrVersionProperty(string entityName, string propName) =>
        propName.Equals("VersionRegistro", StringComparison.OrdinalIgnoreCase) ||
        propName.Equals("CreadoEn", StringComparison.OrdinalIgnoreCase) ||
        propName.Equals("FechaCreacion", StringComparison.OrdinalIgnoreCase) ||
        (entityName == nameof(Animal) && propName.Equals(nameof(Animal.IdAnimal), StringComparison.OrdinalIgnoreCase)) ||
        (entityName == nameof(Lote) && propName.Equals(nameof(Lote.IdLote), StringComparison.OrdinalIgnoreCase)) ||
        (entityName == nameof(Rancho) && propName.Equals(nameof(Rancho.IdRancho), StringComparison.OrdinalIgnoreCase)) ||
        (entityName == nameof(EventoSanitario) && propName.Equals(nameof(EventoSanitario.IdEventoSanitario), StringComparison.OrdinalIgnoreCase)) ||
        (entityName == nameof(Tratamiento) && propName.Equals(nameof(Tratamiento.IdTratamiento), StringComparison.OrdinalIgnoreCase)) ||
        (entityName == nameof(Recordatorio) && propName.Equals(nameof(Recordatorio.IdRecordatorio), StringComparison.OrdinalIgnoreCase)) ||
        (entityName == nameof(Alimentacion) && propName.Equals(nameof(Alimentacion.IdAlimentacion), StringComparison.OrdinalIgnoreCase)) ||
        (entityName == nameof(MovimientoAnimal) && propName.Equals(nameof(MovimientoAnimal.IdMovimiento), StringComparison.OrdinalIgnoreCase));

    private async Task<object?> FindEntityByIdAsync(string entidadNormalizada, string idRegistro, CancellationToken ct)
    {
        switch (entidadNormalizada)
        {
            case nameof(Animal):
                return int.TryParse(idRegistro, out var idAnimal) ? await db.Animales.FindAsync([idAnimal], ct) : null;
            case nameof(Lote):
                return int.TryParse(idRegistro, out var idLote) ? await db.Lotes.FindAsync([idLote], ct) : null;
            case nameof(Rancho):
                return int.TryParse(idRegistro, out var idRancho) ? await db.Ranchos.FindAsync([idRancho], ct) : null;
            case nameof(EventoSanitario):
                return int.TryParse(idRegistro, out var idEv) ? await db.EventosSanitarios.FindAsync([idEv], ct) : null;
            case nameof(Tratamiento):
                return int.TryParse(idRegistro, out var idTr) ? await db.Tratamientos.FindAsync([idTr], ct) : null;
            case nameof(Recordatorio):
                return int.TryParse(idRegistro, out var idRec) ? await db.Recordatorios.FindAsync([idRec], ct) : null;
            case nameof(Alimentacion):
                return await db.Alimentaciones.FindAsync([idRegistro], ct);
            case nameof(MovimientoAnimal):
                return await db.MovimientosAnimales.FindAsync([idRegistro], ct);
            default:
                return null;
        }
    }

    private static object DeserializeEntity(string entidadNormalizada, JsonElement datos)
    {
        var raw = datos.GetRawText();
        return entidadNormalizada switch
        {
            nameof(Animal) => JsonSerializer.Deserialize<Animal>(raw, JsonOptions)!,
            nameof(Lote) => JsonSerializer.Deserialize<Lote>(raw, JsonOptions)!,
            nameof(Rancho) => JsonSerializer.Deserialize<Rancho>(raw, JsonOptions)!,
            nameof(EventoSanitario) => JsonSerializer.Deserialize<EventoSanitario>(raw, JsonOptions)!,
            nameof(Tratamiento) => JsonSerializer.Deserialize<Tratamiento>(raw, JsonOptions)!,
            nameof(Recordatorio) => JsonSerializer.Deserialize<Recordatorio>(raw, JsonOptions)!,
            nameof(Alimentacion) => JsonSerializer.Deserialize<Alimentacion>(raw, JsonOptions)!,
            nameof(MovimientoAnimal) => JsonSerializer.Deserialize<MovimientoAnimal>(raw, JsonOptions)!,
            _ => throw new InvalidOperationException($"Entidad no soportada: {entidadNormalizada}")
        };
    }

    private static void PrepareEntityForCreate(
        string entidadNormalizada,
        object entity,
        OperacionSyncRequest request,
        DateTime ahora)
    {
        switch (entity)
        {
            case Animal a:
                a.IdAnimal = 0;
                if (a.IdRancho == 0) a.IdRancho = request.IdRancho;
                if (a.IdAutor == 0) a.IdAutor = request.IdUsuario;
                a.FechaCreacion = ahora;
                if (a.FechaIngreso == default) a.FechaIngreso = ahora;
                a.VersionRegistro = 1;
                break;
            case Lote l:
                l.IdLote = 0;
                if (l.IdRancho == 0) l.IdRancho = request.IdRancho;
                if (l.IdAutor == 0) l.IdAutor = request.IdUsuario;
                l.FechaCreacion = ahora;
                l.VersionRegistro = 1;
                break;
            case Rancho r:
                r.IdRancho = 0;
                if (r.IdAutor == 0) r.IdAutor = request.IdUsuario;
                r.CreadoEn = ahora;
                r.VersionRegistro = 1;
                break;
            case EventoSanitario e:
                e.IdEventoSanitario = 0;
                if (e.IdAutor == 0) e.IdAutor = request.IdUsuario;
                if (e.Fecha == default) e.Fecha = ahora;
                e.CreadoEn = ahora;
                e.VersionRegistro = 1;
                break;
            case Tratamiento t:
                t.IdTratamiento = 0;
                if (t.IdAutor == 0) t.IdAutor = request.IdUsuario;
                if (t.FechaInicio == default) t.FechaInicio = ahora;
                t.CreadoEn = ahora;
                t.VersionRegistro = 1;
                break;
            case Recordatorio rec:
                rec.IdRecordatorio = 0;
                if (rec.IdRancho == 0) rec.IdRancho = request.IdRancho;
                if (rec.IdAutor == 0) rec.IdAutor = request.IdUsuario;
                if (rec.FechaProgramada == default) rec.FechaProgramada = ahora;
                rec.CreadoEn = ahora;
                rec.VersionRegistro = 1;
                break;
            case Alimentacion al:
                al.IdAlimentacion = string.IsNullOrWhiteSpace(request.IdRegistro)
                    ? Guid.NewGuid().ToString()
                    : request.IdRegistro.Trim();
                al.CreadoEn = ahora;
                al.VersionRegistro = 1;
                break;
            case MovimientoAnimal mov:
                mov.IdMovimiento = string.IsNullOrWhiteSpace(request.IdRegistro)
                    ? Guid.NewGuid().ToString()
                    : request.IdRegistro.Trim();
                mov.CreadoEn = ahora;
                mov.VersionRegistro = 1;
                break;
        }
    }

    private static string GetEntityPrimaryKeyString(string entidadNormalizada, object entity) =>
        entity switch
        {
            Animal a => a.IdAnimal.ToString(),
            Lote l => l.IdLote.ToString(),
            Rancho r => r.IdRancho.ToString(),
            EventoSanitario e => e.IdEventoSanitario.ToString(),
            Tratamiento t => t.IdTratamiento.ToString(),
            Recordatorio rec => rec.IdRecordatorio.ToString(),
            Alimentacion al => al.IdAlimentacion,
            MovimientoAnimal mov => mov.IdMovimiento,
            _ => throw new InvalidOperationException($"Entidad desconocida: {entidadNormalizada}")
        };

    private static long GetEntityVersion(object entity) =>
        entity switch
        {
            Animal a => a.VersionRegistro,
            Lote l => l.VersionRegistro,
            Rancho r => r.VersionRegistro,
            EventoSanitario e => e.VersionRegistro,
            Tratamiento t => t.VersionRegistro,
            Recordatorio rec => rec.VersionRegistro,
            Alimentacion al => al.VersionRegistro,
            MovimientoAnimal mov => mov.VersionRegistro,
            _ => 1
        };

    private static void SetEntityVersion(object entity, long version)
    {
        switch (entity)
        {
            case Animal a: a.VersionRegistro = version; break;
            case Lote l: l.VersionRegistro = version; break;
            case Rancho r: r.VersionRegistro = version; break;
            case EventoSanitario e: e.VersionRegistro = version; break;
            case Tratamiento t: t.VersionRegistro = version; break;
            case Recordatorio rec: rec.VersionRegistro = version; break;
            case Alimentacion al: al.VersionRegistro = version; break;
            case MovimientoAnimal mov: mov.VersionRegistro = version; break;
        }
    }

    private static DateTime? GetEntityDeletedAt(object entity) =>
        entity switch
        {
            Animal a => a.EliminadoEn,
            Lote l => l.EliminadoEn,
            Rancho r => r.EliminadoEn,
            EventoSanitario e => e.EliminadoEn,
            Tratamiento t => t.EliminadoEn,
            Recordatorio rec => rec.EliminadoEn,
            Alimentacion al => al.EliminadoEn,
            MovimientoAnimal mov => mov.EliminadoEn,
            _ => null
        };

    private static void SetEntityDeletedAt(object entity, DateTime deletedAt)
    {
        switch (entity)
        {
            case Animal a: a.EliminadoEn = deletedAt; break;
            case Lote l: l.EliminadoEn = deletedAt; break;
            case Rancho r: r.EliminadoEn = deletedAt; break;
            case EventoSanitario e: e.EliminadoEn = deletedAt; break;
            case Tratamiento t: t.EliminadoEn = deletedAt; break;
            case Recordatorio rec: rec.EliminadoEn = deletedAt; break;
            case Alimentacion al: al.EliminadoEn = deletedAt; break;
            case MovimientoAnimal mov: mov.EliminadoEn = deletedAt; break;
        }
    }

    private static string? NormalizeEntityName(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        return input.Trim().ToLowerInvariant() switch
        {
            "animal" or "animales" or "cattle" => nameof(Animal),
            "lote" or "lotes" or "lots" => nameof(Lote),
            "rancho" or "ranchos" => nameof(Rancho),
            "eventosanitario" or "eventos-sanitarios" or "healthrecords" => nameof(EventoSanitario),
            "tratamiento" or "tratamientos" => nameof(Tratamiento),
            "recordatorio" or "recordatorios" or "alerts" => nameof(Recordatorio),
            "alimentacion" or "alimentaciones" or "feedingrecords" => nameof(Alimentacion),
            "movimientoanimal" or "movimientos-animales" or "movements" => nameof(MovimientoAnimal),
            _ => null
        };
    }

    private static string? NormalizeAction(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        return input.Trim().ToUpperInvariant() switch
        {
            "CREATE" or "CREAR" or "ALTA" => "CREATE",
            "UPDATE" or "ACTUALIZAR" or "MODIFICAR" => "UPDATE",
            "DELETE" or "ELIMINAR" or "BAJA" => "DELETE",
            _ => null
        };
    }

    private static string ComputeRequestHash(
        OperacionSyncRequest request,
        string entidadNormalizada,
        string accionNormalizada)
    {
        var datosRaw = request.Datos.ValueKind == JsonValueKind.Undefined
            ? string.Empty
            : request.Datos.GetRawText();
        var canonical = $"{entidadNormalizada}|{accionNormalizada}|{request.IdRegistro?.Trim() ?? ""}|{request.VersionBase?.ToString() ?? ""}|{datosRaw}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexStringLower(bytes);
    }
}
