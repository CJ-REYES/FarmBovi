using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/sync")]
public sealed partial class SincronizacionController(
    FarmDbContext db,
    ILogger<SincronizacionController>? logger = null) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    [GeneratedRegex(@"^[A-Za-z0-9._:@\-]{3,120}$")]
    private static partial Regex DeviceIdFormatRegex();

    /// <summary>
    /// Lista blanca explícita de propiedades editables por entidad en ApplyPartialUpdate (Punto 5).
    /// Bloquea claves primarias, IdRancho, IdAutor, CreadoEn, VersionRegistro y EliminadoEn.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, HashSet<string>> AllowedUpdateProperties =
        new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase)
        {
            [nameof(Animal)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(Animal.IdLote),
                nameof(Animal.Arete),
                nameof(Animal.Raza),
                nameof(Animal.Sexo),
                nameof(Animal.FechaNacimiento),
                nameof(Animal.FechaIngreso),
                nameof(Animal.Procedencia),
                nameof(Animal.Estado),
                nameof(Animal.FechaSalida),
                nameof(Animal.Observaciones)
            },
            [nameof(Lote)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(Lote.Nombre),
                nameof(Lote.Ubicacion),
                nameof(Lote.Estado)
            },
            [nameof(Rancho)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(Rancho.Nombre),
                nameof(Rancho.UbicacionGeneral),
                nameof(Rancho.Estado)
            },
            [nameof(EventoSanitario)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(EventoSanitario.Tipo),
                nameof(EventoSanitario.Fecha),
                nameof(EventoSanitario.Sintomas),
                nameof(EventoSanitario.Diagnostico),
                nameof(EventoSanitario.ProfesionalDiagnostico),
                nameof(EventoSanitario.EvidenciaDiagnosticoUri),
                nameof(EventoSanitario.Responsable),
                nameof(EventoSanitario.Observaciones)
            },
            [nameof(Tratamiento)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(Tratamiento.Producto),
                nameof(Tratamiento.Dosis),
                nameof(Tratamiento.UnidadDosis),
                nameof(Tratamiento.ViaAdministracion),
                nameof(Tratamiento.Frecuencia),
                nameof(Tratamiento.FechaInicio),
                nameof(Tratamiento.FechaFin),
                nameof(Tratamiento.Responsable),
                nameof(Tratamiento.PrescripcionUri),
                nameof(Tratamiento.Estado)
            },
            [nameof(Recordatorio)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(Recordatorio.IdAnimal),
                nameof(Recordatorio.IdLote),
                nameof(Recordatorio.IdTratamiento),
                nameof(Recordatorio.IdResponsable),
                nameof(Recordatorio.Tipo),
                nameof(Recordatorio.Descripcion),
                nameof(Recordatorio.FechaProgramada),
                nameof(Recordatorio.Estado),
                nameof(Recordatorio.FechaCompletado)
            },
            [nameof(Alimentacion)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(Alimentacion.IdAnimal),
                nameof(Alimentacion.IdLote),
                nameof(Alimentacion.Alimento),
                nameof(Alimentacion.Racion),
                nameof(Alimentacion.Cantidad),
                nameof(Alimentacion.Unidad),
                nameof(Alimentacion.Frecuencia),
                nameof(Alimentacion.Inicio),
                nameof(Alimentacion.Fin),
                nameof(Alimentacion.CambioDieta)
            },
            [nameof(MovimientoAnimal)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(MovimientoAnimal.IdLoteOrigen),
                nameof(MovimientoAnimal.IdLoteDestino),
                nameof(MovimientoAnimal.Tipo),
                nameof(MovimientoAnimal.Fecha),
                nameof(MovimientoAnimal.OrigenExterno),
                nameof(MovimientoAnimal.DestinoExterno),
                nameof(MovimientoAnimal.Motivo)
            },
            [nameof(Pesaje)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(Pesaje.PesoRealKg),
                nameof(Pesaje.Fecha),
                nameof(Pesaje.FuenteBascula),
                nameof(Pesaje.Responsable),
                nameof(Pesaje.Observaciones),
                nameof(Pesaje.OrigenPesaje)
            },
            [nameof(GenealogiaAnimal)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(GenealogiaAnimal.IdPadre),
                nameof(GenealogiaAnimal.IdMadre),
                nameof(GenealogiaAnimal.Observaciones)
            },
            [nameof(EventoReproductivo)] = new(StringComparer.OrdinalIgnoreCase)
            {
                nameof(EventoReproductivo.IdSemental),
                nameof(EventoReproductivo.Tipo),
                nameof(EventoReproductivo.Fecha),
                nameof(EventoReproductivo.Resultado),
                nameof(EventoReproductivo.Observaciones)
            }
        };

    [HttpPost("operaciones")]
    public async Task<IActionResult> RecibirOperacion([FromBody] OperacionSyncRequest request, CancellationToken ct)
    {
        var (idUsuarioJwt, authError) = await ValidateAuthenticatedUserAsync(ct);
        if (authError is not null) return authError;

        if (request.IdOperacion == Guid.Empty)
            return BadRequest("El identificador de operación (idOperacion) es obligatorio.");

        var (idDispositivo, deviceError) = ValidateDeviceIdentity(request.IdDispositivo);
        if (deviceError is not null) return deviceError;

        var ranchError = await ValidateRanchMembershipAsync(idUsuarioJwt, request.IdRancho, ct);
        if (ranchError is not null) return ranchError;

        var entidadNormalizada = NormalizeEntityName(request.Entidad);
        if (entidadNormalizada is null)
            return BadRequest($"La entidad '{request.Entidad}' no está soportada para sincronización.");

        var operacionEstandar = NormalizeOperation(request.ResolverOperacionBruta());
        if (operacionEstandar is null)
            return BadRequest($"La operación '{request.ResolverOperacionBruta()}' no es válida. Usa Crear, Actualizar o Eliminar.");

        if (entidadNormalizada == nameof(Rancho) && operacionEstandar is "Actualizar" or "Eliminar")
        {
            var access = new RanchAccessService(db);
            if (!await access.IsAdminAsync(idUsuarioJwt, request.IdRancho, ct))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    mensaje = "Solo un administrador del rancho puede modificar o eliminar el rancho."
                });
            }
        }

        var payload = request.ResolverPayload();
        var hashSolicitud = ComputeRequestHash(
            idUsuarioJwt,
            request.IdRancho,
            idDispositivo,
            entidadNormalizada,
            request.IdRegistro,
            operacionEstandar,
            request.VersionBase,
            payload);

        // Idempotencia multi-instancia respaldada por PK única en RegistroSyncServidor y transacción BD
        var existente = await db.RegistrosSyncServidor.AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdOperacion == request.IdOperacion, ct);

        if (existente is not null)
        {
            return await BuildIdempotentResultAsync(existente, idUsuarioJwt, request.IdRancho, hashSolicitud, operacionEstandar, ct);
        }

        if (operacionEstandar == "Crear")
        {
            return await ProcesarCreacionAsync(
                request,
                idUsuarioJwt,
                idDispositivo,
                entidadNormalizada,
                operacionEstandar,
                hashSolicitud,
                payload,
                ct);
        }

        return await ProcesarModificacionOEliminacionAsync(
            request,
            idUsuarioJwt,
            idDispositivo,
            entidadNormalizada,
            operacionEstandar,
            hashSolicitud,
            payload,
            ct);
    }

    [HttpGet("operaciones/{idOperacion:guid}")]
    public async Task<IActionResult> ObtenerOperacion(Guid idOperacion, CancellationToken ct)
    {
        var (idUsuarioJwt, authError) = await ValidateAuthenticatedUserAsync(ct);
        if (authError is not null) return authError;

        var item = await db.RegistrosSyncServidor.AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdOperacion == idOperacion, ct);

        if (item is null) return NotFound();

        var ranchError = await ValidateRanchMembershipAsync(idUsuarioJwt, item.IdRancho, ct);
        if (ranchError is not null) return ranchError;

        return Ok(item);
    }

    [HttpGet("auditoria")]
    public async Task<IActionResult> ObtenerAuditoria(
        [FromQuery] Guid idRancho,
        [FromQuery] string? entidad,
        [FromQuery] int limite = 100,
        CancellationToken ct = default)
    {
        var (idUsuarioJwt, authError) = await ValidateAuthenticatedUserAsync(ct);
        if (authError is not null) return authError;

        if (idRancho == Guid.Empty)
            return BadRequest("El parámetro idRancho es obligatorio.");

        if (limite is < 1 or > 500)
            return BadRequest("El límite debe estar entre 1 y 500.");

        var ranchError = await ValidateRanchMembershipAsync(idUsuarioJwt, idRancho, ct);
        if (ranchError is not null) return ranchError;

        var query = db.CambiosServidor.AsNoTracking()
            .Where(c => c.IdRancho == idRancho);

        if (!string.IsNullOrWhiteSpace(entidad))
        {
            var norm = NormalizeEntityName(entidad) ?? entidad.Trim();
            query = query.Where(c => c.Entidad == norm);
        }

        var items = await query
            .OrderByDescending(c => c.OcurrioEn)
            .Take(limite)
            .ToListAsync(ct);

        return Ok(items);
    }

    /// <summary>
    /// Valida el identificador de dispositivo declarado por el cliente.
    /// Nota de alcance: mientras no exista una tabla formal de dispositivos registrados,
    /// IdDispositivo es un identificador de correlación/auditoría (no autenticación criptográfica de hardware).
    /// Si el JWT incluye claim 'device_id'/'idDispositivo' o la cabecera 'X-Device-Id', exige coincidencia.
    /// </summary>
    private (string DeviceId, IActionResult? ErrorResult) ValidateDeviceIdentity(string? rawDeviceId)
    {
        if (string.IsNullOrWhiteSpace(rawDeviceId))
            return (string.Empty, BadRequest("El identificador del dispositivo (idDispositivo) es obligatorio."));

        var normalized = rawDeviceId.Trim();
        if (!DeviceIdFormatRegex().IsMatch(normalized))
        {
            return (string.Empty, BadRequest(
                "El identificador del dispositivo (idDispositivo) debe tener entre 3 y 120 caracteres válidos (letras, números, . _ : @ -)."));
        }

        var jwtDeviceClaim = User?.FindFirstValue("device_id") ?? User?.FindFirstValue("idDispositivo");
        if (!string.IsNullOrWhiteSpace(jwtDeviceClaim) &&
            !string.Equals(jwtDeviceClaim.Trim(), normalized, StringComparison.Ordinal))
        {
            return (string.Empty, StatusCode(StatusCodes.Status403Forbidden, new
            {
                mensaje = "El dispositivo enviado no coincide con el dispositivo autorizado en el token JWT."
            }));
        }

        var headerDevice = HttpContext?.Request.Headers["X-Device-Id"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(headerDevice) &&
            !string.Equals(headerDevice.Trim(), normalized, StringComparison.Ordinal))
        {
            return (string.Empty, BadRequest("La cabecera X-Device-Id no coincide con idDispositivo del cuerpo."));
        }

        return (normalized, null);
    }

    private async Task<IActionResult> BuildIdempotentResultAsync(
        RegistroSyncServidor existente,
        Guid idUsuarioJwt,
        Guid idRancho,
        string hashSolicitud,
        string operacionEstandar,
        CancellationToken ct)
    {
        if (existente.IdUsuario != idUsuarioJwt ||
            existente.IdRancho != idRancho ||
            !string.Equals(existente.HashSolicitud, hashSolicitud, StringComparison.OrdinalIgnoreCase))
        {
            return Conflict(new
            {
                tipoConflicto = "IDEMPOTENCY_HASH_MISMATCH",
                mensaje = "El idOperacion ya fue registrado previamente con usuario, rancho, dispositivo o datos distintos.",
                idOperacion = existente.IdOperacion
            });
        }

        var cambio = await db.CambiosServidor.AsNoTracking()
            .Where(c => c.IdOperacion == existente.IdOperacion)
            .Select(c => (Guid?)c.IdCambio)
            .FirstOrDefaultAsync(ct) ?? Guid.Empty;

        JsonElement? datosElement = null;
        if (!string.Equals(operacionEstandar, "Eliminar", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(existente.Resultado))
        {
            using var docExistente = JsonDocument.Parse(existente.Resultado);
            datosElement = docExistente.RootElement.Clone();
        }

        var respuestaPrevia = new OperacionSyncResponse(
            existente.IdOperacion,
            existente.Entidad,
            existente.IdRegistro,
            operacionEstandar,
            existente.VersionResultante,
            cambio,
            DateTime.SpecifyKind(existente.AplicadoEn, DateTimeKind.Utc),
            DuplicadoIgnorado: true,
            datosElement);

        return Ok(respuestaPrevia);
    }

    private async Task<(Guid UserId, IActionResult? ErrorResult)> ValidateAuthenticatedUserAsync(CancellationToken ct)
    {
        if (User?.Identity?.IsAuthenticated != true)
        {
            return (Guid.Empty, Unauthorized(new { mensaje = "Debe iniciar sesión con un token JWT válido." }));
        }

        var rawClaim = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue("sub")
            ?? User.FindFirstValue("idUsuario");

        if (!Guid.TryParse(rawClaim, out var idUsuario) || idUsuario == Guid.Empty)
        {
            return (Guid.Empty, Unauthorized(new { mensaje = "El token JWT no contiene un claim de usuario válido." }));
        }

        var usuarioActivo = await db.Usuarios.AsNoTracking()
            .AnyAsync(u => u.IdUsuario == idUsuario && u.Estado.ToLower() == "activo", ct);

        if (!usuarioActivo)
        {
            return (Guid.Empty, Unauthorized(new { mensaje = "El usuario autenticado no existe o no está activo." }));
        }

        return (idUsuario, null);
    }

    private async Task<IActionResult?> ValidateRanchMembershipAsync(Guid idUsuario, Guid idRancho, CancellationToken ct)
    {
        if (idRancho == Guid.Empty)
            return BadRequest("El identificador del rancho (idRancho) es obligatorio.");

        var tieneMembresia = await (from ur in db.UsuarioRanchos.AsNoTracking()
                                    join r in db.Ranchos.AsNoTracking() on ur.IdRancho equals r.IdRancho
                                    where ur.IdUsuario == idUsuario
                                       && ur.IdRancho == idRancho
                                       && ur.Estado.ToLower() == "activo"
                                       && ur.FechaBaja == null
                                       && r.EliminadoEn == null
                                    select ur.IdUsuarioRancho).AnyAsync(ct);

        if (!tieneMembresia)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                mensaje = "No tienes membresía activa en el rancho solicitado."
            });
        }

        return null;
    }

    private async Task<IActionResult> ProcesarCreacionAsync(
        OperacionSyncRequest request,
        Guid idUsuarioJwt,
        string idDispositivo,
        string entidadNormalizada,
        string operacionEstandar,
        string hashSolicitud,
        JsonElement payload,
        CancellationToken ct)
    {
        if (payload.ValueKind != JsonValueKind.Object)
            return BadRequest("El payload/datos debe ser un objeto JSON válido para Crear.");

        object entidadNueva;
        try
        {
            entidadNueva = DeserializeEntity(entidadNormalizada, payload);
        }
        catch (JsonException ex)
        {
            return BadRequest($"El payload no coincide con el esquema de {entidadNormalizada}: {ex.Message}");
        }

        var ahora = DateTime.UtcNow;
        PrepareEntityForCreate(entidadNueva, request, idUsuarioJwt, ahora);

        var isolationError = await ValidateEntityBelongsToRanchAsync(entidadNueva, request.IdRancho, isCreate: true, ct);
        if (isolationError is not null) return isolationError;

        var idRegistro = GetEntityPrimaryKeyGuid(entidadNormalizada, entidadNueva);
        var versionResultante = GetEntityVersion(entidadNueva);
        var despuesJson = JsonSerializer.Serialize(entidadNueva, entidadNueva.GetType(), JsonOptions);
        var idCambio = Guid.NewGuid();

        // Diagnóstico explícito previo a guardar para evitar 409 opacos en duplicados de PK/Arete/Lote
        var preCreateConflict = await DetectPreCreateConflictAsync(entidadNormalizada, entidadNueva, idRegistro, request, ct);
        if (preCreateConflict is not null) return preCreateConflict;

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        // Reverificación transaccional entre instancias
        var yaRegistrada = await db.RegistrosSyncServidor.AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdOperacion == request.IdOperacion, ct);
        if (yaRegistrada is not null)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return await BuildIdempotentResultAsync(yaRegistrada, idUsuarioJwt, request.IdRancho, hashSolicitud, operacionEstandar, ct);
        }

        db.Add(entidadNueva);

        RegistrarTrazabilidadSync(
            idCambio,
            request.IdOperacion,
            idUsuarioJwt,
            request.IdRancho,
            idDispositivo,
            entidadNormalizada,
            idRegistro,
            operacionEstandar,
            hashSolicitud,
            versionResultante,
            antesJson: null,
            despuesJson: despuesJson,
            datosPullJson: despuesJson,
            ahora: ahora);

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            db.ClearPendingPushMetadata();
            if (tx is not null) await tx.RollbackAsync(ct);
            db.ChangeTracker.Clear();

            var concurrentOp = await db.RegistrosSyncServidor.AsNoTracking()
                .SingleOrDefaultAsync(r => r.IdOperacion == request.IdOperacion, ct);
            if (concurrentOp is not null)
            {
                return await BuildIdempotentResultAsync(concurrentOp, idUsuarioJwt, request.IdRancho, hashSolicitud, operacionEstandar, ct);
            }

            logger?.LogWarning(
                ex,
                "Sync CREATE DbUpdateException entidad={Entidad} idRegistro={IdRegistro} idRancho={IdRancho} idOperacion={IdOperacion}: {Detalle}",
                entidadNormalizada,
                idRegistro,
                request.IdRancho,
                request.IdOperacion,
                ex.InnerException?.Message ?? ex.Message);

            return Conflict(new
            {
                tipoConflicto = "DUPLICATE_OR_INVALID_REFERENCE",
                mensaje = "No se pudo crear el registro por restricción de unicidad o clave foránea.",
                idOperacion = request.IdOperacion,
                entidad = entidadNormalizada,
                idRegistro
            });
        }

        using var doc = JsonDocument.Parse(despuesJson);
        return CreatedAtAction(
            nameof(ObtenerOperacion),
            new { idOperacion = request.IdOperacion },
            new OperacionSyncResponse(
                request.IdOperacion,
                entidadNormalizada,
                idRegistro,
                operacionEstandar,
                versionResultante,
                idCambio,
                ahora,
                DuplicadoIgnorado: false,
                doc.RootElement.Clone()));
    }

    private async Task<IActionResult> ProcesarModificacionOEliminacionAsync(
        OperacionSyncRequest request,
        Guid idUsuarioJwt,
        string idDispositivo,
        string entidadNormalizada,
        string operacionEstandar,
        string hashSolicitud,
        JsonElement payload,
        CancellationToken ct)
    {
        if (!request.IdRegistro.HasValue || request.IdRegistro.Value == Guid.Empty)
            return BadRequest($"El campo idRegistro es obligatorio para la operación {operacionEstandar}.");

        if (!request.VersionBase.HasValue || request.VersionBase.Value < 1)
            return BadRequest("Debe enviar la versión del registro (versionBase >= 1) para validar concurrencia.");

        var idRegistro = request.IdRegistro.Value;

        await using var tx = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;

        // Reverificación transaccional entre instancias antes de evaluar versión
        var yaRegistrada = await db.RegistrosSyncServidor.AsNoTracking()
            .SingleOrDefaultAsync(r => r.IdOperacion == request.IdOperacion, ct);
        if (yaRegistrada is not null)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return await BuildIdempotentResultAsync(yaRegistrada, idUsuarioJwt, request.IdRancho, hashSolicitud, operacionEstandar, ct);
        }

        var existente = await FindEntityByIdAsync(entidadNormalizada, idRegistro, ct);
        if (existente is null)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return NotFound($"No se encontró el registro '{idRegistro}' en la entidad '{entidadNormalizada}'.");
        }

        var isolationError = await ValidateEntityBelongsToRanchAsync(existente, request.IdRancho, isCreate: false, ct);
        if (isolationError is not null)
        {
            if (tx is not null) await tx.RollbackAsync(ct);
            return isolationError;
        }

        var versionServidor = GetEntityVersion(existente);
        var eliminadoEnServidor = GetEntityDeletedAt(existente);
        var antesJson = JsonSerializer.Serialize(existente, existente.GetType(), JsonOptions);
        using var docServidor = JsonDocument.Parse(antesJson);

        if (eliminadoEnServidor.HasValue)
        {
            // Eliminación idempotente: si el registro ya estaba eliminado en el servidor y la operación
            // solicitada también es Eliminar, confirmar sin generar conflicto innecesario.
            if (operacionEstandar == "Eliminar")
            {
                var ahoraIdemp = DateTime.UtcNow;
                db.RegistrosSyncServidor.Add(new RegistroSyncServidor
                {
                    IdOperacion = request.IdOperacion,
                    IdUsuario = idUsuarioJwt,
                    IdRancho = request.IdRancho,
                    IdDispositivo = idDispositivo,
                    HashSolicitud = hashSolicitud,
                    Entidad = entidadNormalizada,
                    IdRegistro = idRegistro,
                    Resultado = string.Empty,
                    VersionResultante = versionServidor,
                    AplicadoEn = ahoraIdemp
                });
                try
                {
                    await db.SaveChangesAsync(ct);
                    if (tx is not null) await tx.CommitAsync(ct);
                }
                catch (DbUpdateException)
                {
                    if (tx is not null) await tx.RollbackAsync(ct);
                    db.ChangeTracker.Clear();
                }

                return Ok(new OperacionSyncResponse(
                    request.IdOperacion,
                    entidadNormalizada,
                    idRegistro,
                    operacionEstandar,
                    versionServidor,
                    Guid.Empty,
                    ahoraIdemp,
                    DuplicadoIgnorado: true,
                    Datos: null));
            }

            var camposEliminado = await CalcularCamposConflictoDesdeHistorialAsync(
                request.IdRancho, entidadNormalizada, idRegistro,
                request.VersionBase.Value, versionServidor, docServidor.RootElement, payload, ct);

            if (tx is not null) await tx.RollbackAsync(ct);
            return Conflict(new ConflictoSyncResponse(
                TipoConflicto: "DELETED_ON_SERVER",
                Mensaje: "El registro ya fue eliminado previamente en el servidor por otro dispositivo.",
                IdOperacion: request.IdOperacion,
                Entidad: entidadNormalizada,
                IdRegistro: idRegistro,
                VersionEnviada: request.VersionBase,
                VersionServidor: versionServidor,
                CamposModificados: camposEliminado,
                EstadoServidor: docServidor.RootElement.Clone()));
        }

        if (request.VersionBase.Value != versionServidor)
        {
            var camposModificados = await CalcularCamposConflictoDesdeHistorialAsync(
                request.IdRancho, entidadNormalizada, idRegistro,
                request.VersionBase.Value, versionServidor, docServidor.RootElement, payload, ct);

            if (tx is not null) await tx.RollbackAsync(ct);
            return Conflict(new ConflictoSyncResponse(
                TipoConflicto: "VERSION_MISMATCH",
                Mensaje: $"Conflicto de versión: el dispositivo envió la versión {request.VersionBase.Value}, pero la versión actual en el servidor es {versionServidor}.",
                IdOperacion: request.IdOperacion,
                Entidad: entidadNormalizada,
                IdRegistro: idRegistro,
                VersionEnviada: request.VersionBase,
                VersionServidor: versionServidor,
                CamposModificados: camposModificados,
                EstadoServidor: docServidor.RootElement.Clone()));
        }

        var ahora = DateTime.UtcNow;
        if (operacionEstandar == "Actualizar")
        {
            if (payload.ValueKind != JsonValueKind.Object)
            {
                if (tx is not null) await tx.RollbackAsync(ct);
                return BadRequest("El payload/datos debe ser un objeto JSON válido para Actualizar.");
            }

            ApplyPartialUpdate(existente, payload);

            var postUpdateIsolation = await ValidateEntityBelongsToRanchAsync(existente, request.IdRancho, isCreate: false, ct);
            if (postUpdateIsolation is not null)
            {
                if (tx is not null) await tx.RollbackAsync(ct);
                db.ChangeTracker.Clear();
                return postUpdateIsolation;
            }
        }
        else
        {
            SetEntityDeletedAt(existente, ahora);
        }

        db.Entry(existente).Property("VersionRegistro").OriginalValue = request.VersionBase.Value;
        var versionResultante = versionServidor + 1;
        SetEntityVersion(existente, versionResultante);

        var despuesJson = JsonSerializer.Serialize(existente, existente.GetType(), JsonOptions);
        var datosPullJson = operacionEstandar == "Eliminar" ? null : despuesJson;
        var idCambio = Guid.NewGuid();

        RegistrarTrazabilidadSync(
            idCambio,
            request.IdOperacion,
            idUsuarioJwt,
            request.IdRancho,
            idDispositivo,
            entidadNormalizada,
            idRegistro,
            operacionEstandar,
            hashSolicitud,
            versionResultante,
            antesJson: antesJson,
            despuesJson: despuesJson,
            datosPullJson: datosPullJson,
            ahora: ahora);

        try
        {
            await db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ClearPendingPushMetadata();
            if (tx is not null) await tx.RollbackAsync(ct);
            db.ChangeTracker.Clear();

            // Punto 1: si otra instancia ya procesó este mismo IdOperacion, devolver recibo idempotente (nunca VERSION_MISMATCH)
            var concurrentOp = await db.RegistrosSyncServidor.AsNoTracking()
                .SingleOrDefaultAsync(r => r.IdOperacion == request.IdOperacion, ct);
            if (concurrentOp is not null)
            {
                return await BuildIdempotentResultAsync(concurrentOp, idUsuarioJwt, request.IdRancho, hashSolicitud, operacionEstandar, ct);
            }

            var actualEnServidor = await FindEntityByIdAsNoTrackingAsync(entidadNormalizada, idRegistro, ct);
            if (actualEnServidor is null)
                return NotFound($"El registro '{idRegistro}' ya no existe en el servidor.");

            var versionActual = GetEntityVersion(actualEnServidor);
            var estadoActualJson = JsonSerializer.Serialize(actualEnServidor, actualEnServidor.GetType(), JsonOptions);
            using var docActual = JsonDocument.Parse(estadoActualJson);
            var camposConflicto = await CalcularCamposConflictoDesdeHistorialAsync(
                request.IdRancho, entidadNormalizada, idRegistro,
                request.VersionBase.Value, versionActual, docActual.RootElement, payload, ct);

            return Conflict(new ConflictoSyncResponse(
                TipoConflicto: "VERSION_MISMATCH",
                Mensaje: $"Colisión de concurrencia optimista: otro dispositivo modificó el registro simultáneamente (versión actual: {versionActual}).",
                IdOperacion: request.IdOperacion,
                Entidad: entidadNormalizada,
                IdRegistro: idRegistro,
                VersionEnviada: request.VersionBase,
                VersionServidor: versionActual,
                CamposModificados: camposConflicto,
                EstadoServidor: docActual.RootElement.Clone()));
        }
        catch (DbUpdateException ex)
        {
            db.ClearPendingPushMetadata();
            if (tx is not null) await tx.RollbackAsync(ct);
            db.ChangeTracker.Clear();

            var concurrentOp = await db.RegistrosSyncServidor.AsNoTracking()
                .SingleOrDefaultAsync(r => r.IdOperacion == request.IdOperacion, ct);
            if (concurrentOp is not null)
            {
                return await BuildIdempotentResultAsync(concurrentOp, idUsuarioJwt, request.IdRancho, hashSolicitud, operacionEstandar, ct);
            }

            logger?.LogWarning(
                ex,
                "Sync {Operacion} DbUpdateException entidad={Entidad} idRegistro={IdRegistro} idRancho={IdRancho} idOperacion={IdOperacion}: {Detalle}",
                operacionEstandar,
                entidadNormalizada,
                idRegistro,
                request.IdRancho,
                request.IdOperacion,
                ex.InnerException?.Message ?? ex.Message);

            return Conflict(new
            {
                tipoConflicto = "CONSTRAINT_VIOLATION",
                mensaje = "No se pudo aplicar el cambio por una restricción de integridad en la base de datos.",
                idOperacion = request.IdOperacion,
                entidad = entidadNormalizada,
                idRegistro
            });
        }

        JsonElement? datosRespuesta = null;
        if (operacionEstandar != "Eliminar")
        {
            using var docDespues = JsonDocument.Parse(despuesJson);
            datosRespuesta = docDespues.RootElement.Clone();
        }

        return Ok(new OperacionSyncResponse(
            request.IdOperacion,
            entidadNormalizada,
            idRegistro,
            operacionEstandar,
            versionResultante,
            idCambio,
            ahora,
            DuplicadoIgnorado: false,
            datosRespuesta));
    }

    private void RegistrarTrazabilidadSync(
        Guid idCambio,
        Guid idOperacion,
        Guid idUsuarioJwt,
        Guid idRancho,
        string idDispositivo,
        string entidadNormalizada,
        Guid idRegistro,
        string operacionEstandar,
        string hashSolicitud,
        long versionResultante,
        string? antesJson,
        string despuesJson,
        string? datosPullJson,
        DateTime ahora)
    {
        db.RegistrosSyncServidor.Add(new RegistroSyncServidor
        {
            IdOperacion = idOperacion,
            IdUsuario = idUsuarioJwt,
            IdRancho = idRancho,
            IdDispositivo = idDispositivo,
            HashSolicitud = hashSolicitud,
            Entidad = entidadNormalizada,
            IdRegistro = idRegistro,
            Resultado = datosPullJson ?? string.Empty,
            VersionResultante = versionResultante,
            AplicadoEn = ahora
        });

        db.SetPendingPushMetadata(new PushTraceMetadata(
            IdCambio: idCambio,
            IdOperacion: idOperacion,
            IdUsuario: idUsuarioJwt,
            IdRancho: idRancho,
            Entidad: entidadNormalizada,
            IdRegistro: idRegistro,
            Operacion: operacionEstandar,
            Version: versionResultante,
            AntesJson: antesJson,
            DespuesJson: despuesJson,
            DatosPullJson: datosPullJson,
            OcurrioEn: ahora));
    }

    /// <summary>
    /// Calcula los campos modificados usando el historial de CambioServidor desde VersionBase
    /// hasta la versión actual del servidor, evitando falsos positivos en actualizaciones parciales (Punto 2).
    /// </summary>
    private async Task<IReadOnlyList<CampoConflictoDto>> CalcularCamposConflictoDesdeHistorialAsync(
        Guid idRancho,
        string entidad,
        Guid idRegistro,
        long versionBase,
        long versionServidor,
        JsonElement estadoServidor,
        JsonElement datosCliente,
        CancellationToken ct)
    {
        var cambiosDesdeBase = await db.CambiosServidor.AsNoTracking()
            .Where(c => c.IdRancho == idRancho
                     && c.Entidad == entidad
                     && c.IdRegistro == idRegistro
                     && c.Version > versionBase
                     && c.Version <= versionServidor)
            .OrderBy(c => c.Version)
            .ToListAsync(ct);

        var primerCambioConAntes = cambiosDesdeBase.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c.Antes));
        if (primerCambioConAntes is null)
        {
            return CalcularCamposModificados(estadoServidor, datosCliente);
        }

        try
        {
            using var docBase = JsonDocument.Parse(primerCambioConAntes.Antes!);
            var diffsPorHistorial = CalcularCamposModificados(estadoServidor, docBase.RootElement);
            var diffsCliente = CalcularCamposModificados(estadoServidor, datosCliente);

            var porCampo = new Dictionary<string, CampoConflictoDto>(StringComparer.OrdinalIgnoreCase);

            // Primero agregamos cada campo que cambió en el servidor desde VersionBase
            foreach (var d in diffsPorHistorial)
            {
                var valorCliente = TryGetNestedJsonValue(datosCliente, d.Campo, out var valCli)
                    ? valCli.Clone()
                    : d.ValorCliente;
                porCampo[d.Campo] = new CampoConflictoDto(d.Campo, d.ValorServidor, valorCliente);
            }

            // Completamos con diferencias explícitas enviadas por el cliente
            foreach (var d in diffsCliente)
            {
                if (!porCampo.ContainsKey(d.Campo))
                {
                    porCampo[d.Campo] = d;
                }
            }

            return porCampo.Values.ToList();
        }
        catch (JsonException)
        {
            return CalcularCamposModificados(estadoServidor, datosCliente);
        }
    }

    private static bool TryGetNestedJsonValue(JsonElement root, string dottedPath, out JsonElement value)
    {
        value = root;
        if (root.ValueKind != JsonValueKind.Object) return false;

        foreach (var segment in dottedPath.Split('.'))
        {
            if (value.ValueKind != JsonValueKind.Object) return false;
            var found = false;
            foreach (var prop in value.EnumerateObject())
            {
                if (prop.Name.Equals(segment, StringComparison.OrdinalIgnoreCase))
                {
                    value = prop.Value;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }

        return true;
    }

    public static IReadOnlyList<CampoConflictoDto> CalcularCamposModificados(
        JsonElement estadoServidor,
        JsonElement datosCliente)
    {
        var diferencias = new List<CampoConflictoDto>();
        if (estadoServidor.ValueKind != JsonValueKind.Object || datosCliente.ValueKind != JsonValueKind.Object)
            return diferencias;

        CollectDifferencesRecursive(estadoServidor, datosCliente, prefix: string.Empty, diferencias);
        return diferencias;
    }

    private static void CollectDifferencesRecursive(
        JsonElement objServidor,
        JsonElement objCliente,
        string prefix,
        List<CampoConflictoDto> diferencias)
    {
        var propsServidor = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        foreach (var prop in objServidor.EnumerateObject())
        {
            propsServidor[prop.Name] = prop.Value;
        }

        foreach (var propCliente in objCliente.EnumerateObject())
        {
            if (string.IsNullOrEmpty(prefix) && IsMetadataProperty(propCliente.Name))
                continue;

            var fieldPath = string.IsNullOrEmpty(prefix)
                ? propCliente.Name
                : $"{prefix}.{propCliente.Name}";

            if (!propsServidor.TryGetValue(propCliente.Name, out var valorServidor))
            {
                if (propCliente.Value.ValueKind != JsonValueKind.Null &&
                    propCliente.Value.ValueKind != JsonValueKind.Undefined)
                {
                    using var nullDoc = JsonDocument.Parse("null");
                    diferencias.Add(new CampoConflictoDto(
                        fieldPath,
                        nullDoc.RootElement.Clone(),
                        propCliente.Value.Clone()));
                }
                continue;
            }

            if (!JsonElementsDeepEqual(valorServidor, propCliente.Value))
            {
                diferencias.Add(new CampoConflictoDto(
                    fieldPath,
                    valorServidor.Clone(),
                    propCliente.Value.Clone()));

                if (valorServidor.ValueKind == JsonValueKind.Object &&
                    propCliente.Value.ValueKind == JsonValueKind.Object)
                {
                    CollectDifferencesRecursive(valorServidor, propCliente.Value, fieldPath, diferencias);
                }
            }
        }
    }

    private static bool JsonElementsDeepEqual(JsonElement a, JsonElement b)
    {
        if (a.ValueKind != b.ValueKind)
            return false;

        switch (a.ValueKind)
        {
            case JsonValueKind.String:
                var sa = a.GetString();
                var sb = b.GetString();
                if (string.Equals(sa, sb, StringComparison.Ordinal)) return true;
                if (DateTimeOffset.TryParse(sa, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var da) &&
                    DateTimeOffset.TryParse(sb, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var db))
                {
                    return da.UtcTicks == db.UtcTicks;
                }
                if (Guid.TryParse(sa, out var ga) && Guid.TryParse(sb, out var gb))
                {
                    return ga == gb;
                }
                return false;

            case JsonValueKind.Number:
                if (a.TryGetDecimal(out var decA) && b.TryGetDecimal(out var decB))
                    return decA == decB;
                return a.GetDouble().Equals(b.GetDouble());

            case JsonValueKind.True:
            case JsonValueKind.False:
                return a.GetBoolean() == b.GetBoolean();

            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return true;

            case JsonValueKind.Array:
                if (a.GetArrayLength() != b.GetArrayLength()) return false;
                var enumA = a.EnumerateArray();
                var enumB = b.EnumerateArray();
                while (enumA.MoveNext() && enumB.MoveNext())
                {
                    if (!JsonElementsDeepEqual(enumA.Current, enumB.Current))
                        return false;
                }
                return true;

            case JsonValueKind.Object:
                var dictA = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
                foreach (var p in a.EnumerateObject()) dictA[p.Name] = p.Value;

                var dictB = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
                foreach (var p in b.EnumerateObject()) dictB[p.Name] = p.Value;

                if (dictA.Count != dictB.Count) return false;
                foreach (var (key, valA) in dictA)
                {
                    if (!dictB.TryGetValue(key, out var valB)) return false;
                    if (!JsonElementsDeepEqual(valA, valB)) return false;
                }
                return true;

            default:
                return string.Equals(a.GetRawText(), b.GetRawText(), StringComparison.Ordinal);
        }
    }

    private static bool IsMetadataProperty(string name) =>
        name.Equals("versionRegistro", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("creadoEn", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("eliminadoEn", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idAutor", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idAnimal", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idLote", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idRancho", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idEventoSanitario", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idTratamiento", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idRecordatorio", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idAlimentacion", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idMovimiento", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idPesaje", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idGenealogia", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("idEventoReproductivo", StringComparison.OrdinalIgnoreCase);

    public static void ApplyPartialUpdate(object entity, JsonElement datos)
    {
        var type = entity.GetType();
        if (!AllowedUpdateProperties.TryGetValue(type.Name, out var whitelist))
            return;

        var props = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.CanWrite && whitelist.Contains(p.Name))
            .ToDictionary(p => p.Name, p => p, StringComparer.OrdinalIgnoreCase);

        foreach (var jsonProp in datos.EnumerateObject())
        {
            if (!whitelist.Contains(jsonProp.Name)) continue;
            if (!props.TryGetValue(jsonProp.Name, out var propInfo)) continue;

            var value = JsonSerializer.Deserialize(jsonProp.Value.GetRawText(), propInfo.PropertyType, JsonOptions);
            propInfo.SetValue(entity, value);
        }

        if (entity is GenealogiaAnimal gen)
        {
            gen.Observaciones = string.IsNullOrWhiteSpace(gen.Observaciones)
                ? null
                : gen.Observaciones.Trim();
        }
        else if (entity is EventoReproductivo er)
        {
            er.Tipo = er.Tipo?.Trim() ?? string.Empty;
            er.Resultado = string.IsNullOrWhiteSpace(er.Resultado) ? null : er.Resultado.Trim();
            er.Observaciones = string.IsNullOrWhiteSpace(er.Observaciones) ? null : er.Observaciones.Trim();
        }
    }

    private async Task<IActionResult?> ValidateEntityBelongsToRanchAsync(
        object entity,
        Guid expectedRanchoId,
        bool isCreate,
        CancellationToken ct)
    {
        switch (entity)
        {
            case Rancho r:
                if (!isCreate && r.IdRancho != expectedRanchoId)
                    return ForbidRanchMismatch();
                return null;

            case Lote l:
                if (l.IdRancho != expectedRanchoId)
                    return ForbidRanchMismatch();
                return null;

            case Animal a:
                if (a.IdRancho != expectedRanchoId)
                    return ForbidRanchMismatch();
                if (a.IdLote.HasValue && a.IdLote.Value != Guid.Empty)
                {
                    var loteOk = await db.Lotes.AsNoTracking()
                        .AnyAsync(l => l.IdLote == a.IdLote.Value && l.IdRancho == expectedRanchoId && l.EliminadoEn == null, ct);
                    if (!loteOk)
                        return BadRequest("El lote asignado al animal no existe o no pertenece al rancho autorizado.");
                }
                return null;

            case Recordatorio rec:
            {
                if (rec.IdRancho != expectedRanchoId)
                    return ForbidRanchMismatch();

                if (rec.IdAnimal.HasValue && rec.IdLote.HasValue)
                    return BadRequest("El recordatorio no puede asociarse simultáneamente a un animal y a un lote.");

                if (rec.IdAnimal.HasValue && rec.IdAnimal.Value != Guid.Empty)
                {
                    var animalRancho = await db.Animales.AsNoTracking()
                        .Where(a => a.IdAnimal == rec.IdAnimal.Value)
                        .Select(a => a.IdRancho)
                        .FirstOrDefaultAsync(ct);
                    if (animalRancho == Guid.Empty)
                        return BadRequest("El animal asociado al recordatorio no existe.");
                    if (animalRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }

                if (rec.IdLote.HasValue && rec.IdLote.Value != Guid.Empty)
                {
                    var loteRancho = await db.Lotes.AsNoTracking()
                        .Where(l => l.IdLote == rec.IdLote.Value)
                        .Select(l => l.IdRancho)
                        .FirstOrDefaultAsync(ct);
                    if (loteRancho == Guid.Empty)
                        return BadRequest("El lote asociado al recordatorio no existe.");
                    if (loteRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }

                if (rec.IdTratamiento.HasValue && rec.IdTratamiento.Value != Guid.Empty)
                {
                    var tratRancho = await (from t in db.Tratamientos.AsNoTracking()
                                            join e in db.EventosSanitarios.AsNoTracking() on t.IdEventoSanitario equals e.IdEventoSanitario
                                            join a in db.Animales.AsNoTracking() on e.IdAnimal equals a.IdAnimal
                                            where t.IdTratamiento == rec.IdTratamiento.Value
                                            select a.IdRancho).FirstOrDefaultAsync(ct);
                    if (tratRancho == Guid.Empty)
                        return BadRequest("El tratamiento asociado al recordatorio no existe.");
                    if (tratRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }

                if (rec.IdResponsable.HasValue && rec.IdResponsable.Value != Guid.Empty)
                {
                    var respOk = await (from ur in db.UsuarioRanchos.AsNoTracking()
                                        join u in db.Usuarios.AsNoTracking() on ur.IdUsuario equals u.IdUsuario
                                        where ur.IdUsuario == rec.IdResponsable.Value
                                           && ur.IdRancho == expectedRanchoId
                                           && ur.FechaBaja == null
                                           && ur.Estado.ToLower() == "activo"
                                           && u.Estado.ToLower() == "activo"
                                        select ur.IdUsuarioRancho).AnyAsync(ct);
                    if (!respOk)
                        return ForbidRanchMismatch();
                }

                return null;
            }

            case EventoSanitario ev:
            {
                var animalRancho = await db.Animales.AsNoTracking()
                    .Where(a => a.IdAnimal == ev.IdAnimal)
                    .Select(a => a.IdRancho)
                    .FirstOrDefaultAsync(ct);
                if (animalRancho == Guid.Empty)
                    return BadRequest("El animal asociado al evento sanitario no existe.");
                if (animalRancho != expectedRanchoId)
                    return ForbidRanchMismatch();
                return null;
            }

            case MovimientoAnimal mov:
            {
                var animalRancho = await db.Animales.AsNoTracking()
                    .Where(a => a.IdAnimal == mov.IdAnimal)
                    .Select(a => a.IdRancho)
                    .FirstOrDefaultAsync(ct);
                if (animalRancho == Guid.Empty)
                    return BadRequest("El animal asociado al movimiento no existe.");
                if (animalRancho != expectedRanchoId)
                    return ForbidRanchMismatch();

                if (mov.IdLoteOrigen.HasValue && mov.IdLoteOrigen.Value != Guid.Empty)
                {
                    var origenRancho = await db.Lotes.AsNoTracking()
                        .Where(l => l.IdLote == mov.IdLoteOrigen.Value)
                        .Select(l => l.IdRancho)
                        .FirstOrDefaultAsync(ct);
                    if (origenRancho == Guid.Empty)
                        return BadRequest("El lote de origen del movimiento no existe.");
                    if (origenRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }

                if (mov.IdLoteDestino.HasValue && mov.IdLoteDestino.Value != Guid.Empty)
                {
                    var destinoRancho = await db.Lotes.AsNoTracking()
                        .Where(l => l.IdLote == mov.IdLoteDestino.Value)
                        .Select(l => l.IdRancho)
                        .FirstOrDefaultAsync(ct);
                    if (destinoRancho == Guid.Empty)
                        return BadRequest("El lote de destino del movimiento no existe.");
                    if (destinoRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }

                return null;
            }

            case Pesaje pesaje:
            {
                var pesoError = FarmDomainValidationService.ValidatePesaje(pesaje.PesoRealKg);
                if (pesoError is not null)
                    return BadRequest(pesoError);

                var animalRancho = await db.Animales.AsNoTracking()
                    .Where(a => a.IdAnimal == pesaje.IdAnimal)
                    .Select(a => a.IdRancho)
                    .FirstOrDefaultAsync(ct);
                if (animalRancho == Guid.Empty)
                    return BadRequest("El animal asociado al pesaje no existe.");
                if (animalRancho != expectedRanchoId)
                    return ForbidRanchMismatch();
                return null;
            }

            case GenealogiaAnimal gen:
                return await ValidateGenealogyForSyncAsync(gen, expectedRanchoId, isCreate, ct);

            case EventoReproductivo er:
            {
                var animal = await db.Animales.AsNoTracking()
                    .FirstOrDefaultAsync(a => a.IdAnimal == er.IdAnimal, ct);
                if (animal is null)
                    return BadRequest("El animal asociado al evento reproductivo no existe.");
                if (animal.IdRancho != expectedRanchoId)
                    return ForbidRanchMismatch();

                if (er.IdSemental is { } sementalId && sementalId != Guid.Empty)
                {
                    var sementalRancho = await db.Animales.AsNoTracking()
                        .Where(a => a.IdAnimal == sementalId)
                        .Select(a => a.IdRancho)
                        .FirstOrDefaultAsync(ct);
                    if (sementalRancho == Guid.Empty)
                        return BadRequest("El semental asociado al evento reproductivo no existe.");
                    if (sementalRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }

                if (isCreate || er.EliminadoEn is null)
                {
                    er.Fecha = ApiProblemResults.EnsureUtc(er.Fecha);
                    var validator = new FarmDomainValidationService(db);
                    var domainError = await validator.ValidateEventoReproductivoAsync(
                        er,
                        isCreate ? null : er.IdEventoReproductivo,
                        ct);
                    if (domainError is not null)
                        return BadRequest(domainError);
                }

                return null;
            }

            case Alimentacion al:
            {
                var hasAnimal = al.IdAnimal.HasValue && al.IdAnimal.Value != Guid.Empty;
                var hasLote = al.IdLote.HasValue && al.IdLote.Value != Guid.Empty;
                if (hasAnimal == hasLote)
                    return BadRequest("Debe informarse exactamente uno entre idAnimal e idLote en la alimentación.");

                if (hasAnimal)
                {
                    var animalRancho = await db.Animales.AsNoTracking()
                        .Where(a => a.IdAnimal == al.IdAnimal!.Value)
                        .Select(a => a.IdRancho)
                        .FirstOrDefaultAsync(ct);
                    if (animalRancho == Guid.Empty)
                        return BadRequest("El animal asociado a la alimentación no existe.");
                    if (animalRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }

                if (hasLote)
                {
                    var loteRancho = await db.Lotes.AsNoTracking()
                        .Where(l => l.IdLote == al.IdLote!.Value)
                        .Select(l => l.IdRancho)
                        .FirstOrDefaultAsync(ct);
                    if (loteRancho == Guid.Empty)
                        return BadRequest("El lote asociado a la alimentación no existe.");
                    if (loteRancho != expectedRanchoId)
                        return ForbidRanchMismatch();
                }
                return null;
            }

            case Tratamiento tr:
            {
                var evAnimalId = await db.EventosSanitarios.AsNoTracking()
                    .Where(e => e.IdEventoSanitario == tr.IdEventoSanitario)
                    .Select(e => e.IdAnimal)
                    .FirstOrDefaultAsync(ct);
                if (evAnimalId == Guid.Empty)
                    return BadRequest("El evento sanitario asociado al tratamiento no existe.");
                var animalRancho = await db.Animales.AsNoTracking()
                    .Where(a => a.IdAnimal == evAnimalId)
                    .Select(a => a.IdRancho)
                    .FirstOrDefaultAsync(ct);
                if (animalRancho != expectedRanchoId)
                    return ForbidRanchMismatch();
                return null;
            }

            default:
                return null;
        }
    }

    private async Task<IActionResult?> DetectPreCreateConflictAsync(
        string entidadNormalizada,
        object entidadNueva,
        Guid idRegistro,
        OperacionSyncRequest request,
        CancellationToken ct)
    {
        var existingByPk = await FindEntityByIdAsNoTrackingAsync(entidadNormalizada, idRegistro, ct);
        if (existingByPk is not null)
        {
            var versionActual = GetEntityVersion(existingByPk);
            var eliminado = GetEntityDeletedAt(existingByPk);
            return Conflict(new
            {
                tipoConflicto = "DUPLICATE_OR_INVALID_REFERENCE",
                campo = "idRegistro",
                mensaje = eliminado.HasValue
                    ? $"El registro '{idRegistro}' de '{entidadNormalizada}' ya existe en el servidor (desactivado)."
                    : $"El registro '{idRegistro}' de '{entidadNormalizada}' ya existe en el servidor (versión {versionActual}).",
                idOperacion = request.IdOperacion,
                entidad = entidadNormalizada,
                idRegistro,
                versionServidor = versionActual
            });
        }

        switch (entidadNueva)
        {
            case Animal a:
            {
                var normalizedArete = (a.Arete ?? string.Empty).Trim();
                if (normalizedArete.Length > 0)
                {
                    var dupArete = await db.Animales.AsNoTracking()
                        .FirstOrDefaultAsync(
                            x => x.IdRancho == request.IdRancho && x.Arete.ToLower() == normalizedArete.ToLower(),
                            ct);
                    if (dupArete is not null)
                    {
                        var detalleEstado = dupArete.EliminadoEn.HasValue
                            ? "en un registro desactivado previamente"
                            : "en otro bovino activo";
                        return Conflict(new
                        {
                            tipoConflicto = "DUPLICATE_OR_INVALID_REFERENCE",
                            campo = "arete",
                            mensaje = $"Ya existe el arete '{normalizedArete}' en este rancho ({detalleEstado}).",
                            idOperacion = request.IdOperacion,
                            entidad = entidadNormalizada,
                            idRegistro
                        });
                    }
                }
                break;
            }
            case Lote l:
            {
                var normalizedNombre = (l.Nombre ?? string.Empty).Trim();
                if (normalizedNombre.Length > 0)
                {
                    var dupLote = await db.Lotes.AsNoTracking()
                        .FirstOrDefaultAsync(
                            x => x.IdRancho == request.IdRancho && x.Nombre.ToLower() == normalizedNombre.ToLower(),
                            ct);
                    if (dupLote is not null)
                    {
                        return Conflict(new
                        {
                            tipoConflicto = "DUPLICATE_OR_INVALID_REFERENCE",
                            campo = "nombre",
                            mensaje = $"Ya existe un lote/potrero llamado '{normalizedNombre}' en este rancho.",
                            idOperacion = request.IdOperacion,
                            entidad = entidadNormalizada,
                            idRegistro
                        });
                    }
                }
                break;
            }
            case GenealogiaAnimal gen:
            {
                var dupGen = await db.GenealogiasAnimales.AsNoTracking()
                    .FirstOrDefaultAsync(x => x.IdAnimal == gen.IdAnimal, ct);
                if (dupGen is not null)
                {
                    var detalleEstado = dupGen.EliminadoEn.HasValue
                        ? "en un registro desactivado previamente"
                        : "en un vínculo genealógico activo";
                    return Conflict(new
                    {
                        tipoConflicto = "DUPLICATE_OR_INVALID_REFERENCE",
                        campo = "idAnimal",
                        mensaje = $"El animal '{gen.IdAnimal}' ya cuenta con genealogía registrada ({detalleEstado}).",
                        idOperacion = request.IdOperacion,
                        entidad = entidadNormalizada,
                        idRegistro,
                        idExistente = dupGen.IdGenealogia,
                        versionServidor = dupGen.VersionRegistro
                    });
                }
                break;
            }
        }

        return null;
    }

    private static readonly HashSet<string> SyncMaleSexes = new(StringComparer.OrdinalIgnoreCase)
    {
        "macho", "masculino", "m", "male"
    };

    private static readonly HashSet<string> SyncFemaleSexes = new(StringComparer.OrdinalIgnoreCase)
    {
        "hembra", "femenino", "h", "f", "female"
    };

    private static readonly HashSet<string> SyncUnknownSexes = new(StringComparer.OrdinalIgnoreCase)
    {
        "desconocido", "desconocida", "unknown", "nd", "n/a", "indefinido", "indeterminado", "sin especificar"
    };

    private static bool IsSyncValidFatherSex(string? sexo) =>
        string.IsNullOrWhiteSpace(sexo) || SyncUnknownSexes.Contains(sexo.Trim()) || SyncMaleSexes.Contains(sexo.Trim());

    private static bool IsSyncValidMotherSex(string? sexo) =>
        string.IsNullOrWhiteSpace(sexo) || SyncUnknownSexes.Contains(sexo.Trim()) || SyncFemaleSexes.Contains(sexo.Trim());

    private async Task<IActionResult?> ValidateGenealogyForSyncAsync(
        GenealogiaAnimal gen,
        Guid expectedRanchoId,
        bool isCreate,
        CancellationToken ct)
    {
        if (gen.IdAnimal == Guid.Empty)
            return BadRequest("El identificador del animal (idAnimal) es obligatorio.");

        var animal = await db.Animales.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAnimal == gen.IdAnimal, ct);
        if (animal is null)
            return BadRequest("El animal descendiente especificado no existe.");
        if (animal.IdRancho != expectedRanchoId)
            return ForbidRanchMismatch();
        if (isCreate && animal.EliminadoEn.HasValue)
            return BadRequest("El animal descendiente especificado está eliminado.");

        if (!gen.IdPadre.HasValue && !gen.IdMadre.HasValue)
            return BadRequest("Debe especificar al menos un padre (idPadre) o una madre (idMadre).");

        if (gen.IdPadre == Guid.Empty || gen.IdMadre == Guid.Empty)
            return BadRequest("Los identificadores de padre y madre no pueden ser GUID vacíos.");

        if (gen.IdPadre == gen.IdAnimal || gen.IdMadre == gen.IdAnimal)
            return BadRequest("Un animal no puede ser su propio padre o madre.");

        if (gen.IdPadre.HasValue && gen.IdPadre == gen.IdMadre)
            return BadRequest("El padre y la madre no pueden ser el mismo animal.");

        gen.Observaciones = string.IsNullOrWhiteSpace(gen.Observaciones) ? null : gen.Observaciones.Trim();
        if (gen.Observaciones is not null && gen.Observaciones.Length > GenealogiaService.MaxObservacionesLength)
            return BadRequest($"Las observaciones no pueden exceder {GenealogiaService.MaxObservacionesLength} caracteres.");

        if (gen.IdPadre is { } padreId)
        {
            var padre = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == padreId, ct);
            if (padre is null || (isCreate && padre.EliminadoEn.HasValue))
                return BadRequest("El padre especificado no existe o está eliminado.");
            if (padre.IdRancho != expectedRanchoId)
                return ForbidRanchMismatch();
            if (!IsSyncValidFatherSex(padre.Sexo))
                return BadRequest("El padre especificado debe ser de sexo macho.");
            if (animal.FechaNacimiento.HasValue && padre.FechaNacimiento.HasValue &&
                padre.FechaNacimiento.Value.Date >= animal.FechaNacimiento.Value.Date)
                return BadRequest("La fecha de nacimiento del padre debe ser anterior a la fecha de nacimiento del animal descendiente.");
        }

        if (gen.IdMadre is { } madreId)
        {
            var madre = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == madreId, ct);
            if (madre is null || (isCreate && madre.EliminadoEn.HasValue))
                return BadRequest("La madre especificada no existe o está eliminada.");
            if (madre.IdRancho != expectedRanchoId)
                return ForbidRanchMismatch();
            if (!IsSyncValidMotherSex(madre.Sexo))
                return BadRequest("La madre especificada debe ser de sexo hembra.");
            if (animal.FechaNacimiento.HasValue && madre.FechaNacimiento.HasValue &&
                madre.FechaNacimiento.Value.Date >= animal.FechaNacimiento.Value.Date)
                return BadRequest("La fecha de nacimiento de la madre debe ser anterior a la fecha de nacimiento del animal descendiente.");
        }

        if (await CreatesGenealogyCycleAsync(gen.IdAnimal, gen.IdPadre, gen.IdMadre, expectedRanchoId, gen.IdGenealogia, ct))
            return BadRequest("La relación solicitada genera un ciclo genealógico: el animal descendiente ya es ancestro de uno de sus progenitores.");

        return null;
    }

    private async Task<bool> CreatesGenealogyCycleAsync(
        Guid idAnimal,
        Guid? idPadre,
        Guid? idMadre,
        Guid idRancho,
        Guid excludeGenealogyId,
        CancellationToken ct)
    {
        var visited = new HashSet<Guid>();
        var frontier = new List<Guid>();

        if (idPadre is { } p && visited.Add(p)) frontier.Add(p);
        if (idMadre is { } m && visited.Add(m)) frontier.Add(m);

        while (frontier.Count > 0)
        {
            if (frontier.Contains(idAnimal)) return true;

            var levelRels = await (
                from g in db.GenealogiasAnimales.AsNoTracking()
                join a in db.Animales.AsNoTracking() on g.IdAnimal equals a.IdAnimal
                where g.EliminadoEn == null
                      && g.IdGenealogia != excludeGenealogyId
                      && a.EliminadoEn == null
                      && a.IdRancho == idRancho
                      && frontier.Contains(g.IdAnimal)
                select new { g.IdPadre, g.IdMadre }
            ).ToListAsync(ct);

            var nextFrontier = new List<Guid>();
            foreach (var rel in levelRels)
            {
                if (rel.IdPadre is { } nextP)
                {
                    if (nextP == idAnimal) return true;
                    if (visited.Add(nextP)) nextFrontier.Add(nextP);
                }
                if (rel.IdMadre is { } nextM)
                {
                    if (nextM == idAnimal) return true;
                    if (visited.Add(nextM)) nextFrontier.Add(nextM);
                }
            }

            frontier = nextFrontier;
        }

        return false;
    }

    private IActionResult ForbidRanchMismatch() =>
        StatusCode(StatusCodes.Status403Forbidden, new
        {
            mensaje = "El registro objetivo pertenece a otro rancho fuera de tu autorización."
        });

    private async Task<object?> FindEntityByIdAsync(string entidadNormalizada, Guid idRegistro, CancellationToken ct) =>
        entidadNormalizada switch
        {
            nameof(Animal) => await db.Animales.FindAsync([idRegistro], ct),
            nameof(Lote) => await db.Lotes.FindAsync([idRegistro], ct),
            nameof(Rancho) => await db.Ranchos.FindAsync([idRegistro], ct),
            nameof(EventoSanitario) => await db.EventosSanitarios.FindAsync([idRegistro], ct),
            nameof(Tratamiento) => await db.Tratamientos.FindAsync([idRegistro], ct),
            nameof(Recordatorio) => await db.Recordatorios.FindAsync([idRegistro], ct),
            nameof(Alimentacion) => await db.Alimentaciones.FindAsync([idRegistro], ct),
            nameof(MovimientoAnimal) => await db.MovimientosAnimales.FindAsync([idRegistro], ct),
            nameof(Pesaje) => await db.Pesajes.FindAsync([idRegistro], ct),
            nameof(GenealogiaAnimal) => await db.GenealogiasAnimales.FindAsync([idRegistro], ct),
            nameof(EventoReproductivo) => await db.EventosReproductivos.FindAsync([idRegistro], ct),
            _ => null
        };

    private async Task<object?> FindEntityByIdAsNoTrackingAsync(string entidadNormalizada, Guid idRegistro, CancellationToken ct) =>
        entidadNormalizada switch
        {
            nameof(Animal) => await db.Animales.AsNoTracking().FirstOrDefaultAsync(x => x.IdAnimal == idRegistro, ct),
            nameof(Lote) => await db.Lotes.AsNoTracking().FirstOrDefaultAsync(x => x.IdLote == idRegistro, ct),
            nameof(Rancho) => await db.Ranchos.AsNoTracking().FirstOrDefaultAsync(x => x.IdRancho == idRegistro, ct),
            nameof(EventoSanitario) => await db.EventosSanitarios.AsNoTracking().FirstOrDefaultAsync(x => x.IdEventoSanitario == idRegistro, ct),
            nameof(Tratamiento) => await db.Tratamientos.AsNoTracking().FirstOrDefaultAsync(x => x.IdTratamiento == idRegistro, ct),
            nameof(Recordatorio) => await db.Recordatorios.AsNoTracking().FirstOrDefaultAsync(x => x.IdRecordatorio == idRegistro, ct),
            nameof(Alimentacion) => await db.Alimentaciones.AsNoTracking().FirstOrDefaultAsync(x => x.IdAlimentacion == idRegistro, ct),
            nameof(MovimientoAnimal) => await db.MovimientosAnimales.AsNoTracking().FirstOrDefaultAsync(x => x.IdMovimiento == idRegistro, ct),
            nameof(Pesaje) => await db.Pesajes.AsNoTracking().FirstOrDefaultAsync(x => x.IdPesaje == idRegistro, ct),
            nameof(GenealogiaAnimal) => await db.GenealogiasAnimales.AsNoTracking().FirstOrDefaultAsync(x => x.IdGenealogia == idRegistro, ct),
            nameof(EventoReproductivo) => await db.EventosReproductivos.AsNoTracking().FirstOrDefaultAsync(x => x.IdEventoReproductivo == idRegistro, ct),
            _ => null
        };

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
            nameof(Pesaje) => JsonSerializer.Deserialize<Pesaje>(raw, JsonOptions)!,
            nameof(GenealogiaAnimal) => JsonSerializer.Deserialize<GenealogiaAnimal>(raw, JsonOptions)!,
            nameof(EventoReproductivo) => JsonSerializer.Deserialize<EventoReproductivo>(raw, JsonOptions)!,
            _ => throw new InvalidOperationException($"Entidad no soportada: {entidadNormalizada}")
        };
    }

    private static void PrepareEntityForCreate(
        object entity,
        OperacionSyncRequest request,
        Guid idUsuarioJwt,
        DateTime ahora)
    {
        var targetId = request.IdRegistro is { } regId && regId != Guid.Empty
            ? regId
            : Guid.NewGuid();

        switch (entity)
        {
            case Animal a:
                a.IdAnimal = targetId;
                a.IdRancho = request.IdRancho;
                a.IdAutor = idUsuarioJwt;
                a.CreadoEn = ahora;
                if (a.FechaIngreso == default) a.FechaIngreso = ahora.Date;
                if (string.IsNullOrWhiteSpace(a.Procedencia)) a.Procedencia = "Propio";
                if (string.IsNullOrWhiteSpace(a.Estado)) a.Estado = "Activo";
                a.VersionRegistro = 1;
                a.EliminadoEn = null;
                break;

            case Lote l:
                l.IdLote = targetId;
                l.IdRancho = request.IdRancho;
                l.IdAutor = idUsuarioJwt;
                l.CreadoEn = ahora;
                if (string.IsNullOrWhiteSpace(l.Estado)) l.Estado = "Activo";
                l.VersionRegistro = 1;
                l.EliminadoEn = null;
                break;

            case Rancho r:
                r.IdRancho = request.IdRancho != Guid.Empty ? request.IdRancho : targetId;
                r.IdAutor = idUsuarioJwt;
                r.CreadoEn = ahora;
                if (string.IsNullOrWhiteSpace(r.Estado)) r.Estado = "Activo";
                r.VersionRegistro = 1;
                r.EliminadoEn = null;
                break;

            case EventoSanitario e:
                e.IdEventoSanitario = targetId;
                e.IdAutor = idUsuarioJwt;
                if (e.Fecha == default) e.Fecha = ahora;
                e.CreadoEn = ahora;
                e.VersionRegistro = 1;
                e.EliminadoEn = null;
                break;

            case Tratamiento t:
                t.IdTratamiento = targetId;
                t.IdAutor = idUsuarioJwt;
                if (t.FechaInicio == default) t.FechaInicio = ahora;
                t.CreadoEn = ahora;
                t.VersionRegistro = 1;
                t.EliminadoEn = null;
                break;

            case Recordatorio rec:
                rec.IdRecordatorio = targetId;
                rec.IdRancho = request.IdRancho;
                rec.IdAutor = idUsuarioJwt;
                if (rec.FechaProgramada == default) rec.FechaProgramada = ahora;
                rec.CreadoEn = ahora;
                rec.VersionRegistro = 1;
                rec.EliminadoEn = null;
                break;

            case Alimentacion al:
                al.IdAlimentacion = targetId;
                al.IdAutor = idUsuarioJwt;
                if (al.Inicio == default) al.Inicio = ahora;
                al.CreadoEn = ahora;
                al.VersionRegistro = 1;
                al.EliminadoEn = null;
                break;

            case MovimientoAnimal mov:
                mov.IdMovimiento = targetId;
                mov.IdAutor = idUsuarioJwt;
                if (mov.Fecha == default) mov.Fecha = ahora;
                mov.CreadoEn = ahora;
                mov.VersionRegistro = 1;
                mov.EliminadoEn = null;
                break;

            case Pesaje pesaje:
                pesaje.IdPesaje = targetId;
                pesaje.IdAutor = idUsuarioJwt;
                if (pesaje.Fecha == default) pesaje.Fecha = ahora;
                if (string.IsNullOrWhiteSpace(pesaje.FuenteBascula)) pesaje.FuenteBascula = "Báscula registrada en campo";
                if (string.IsNullOrWhiteSpace(pesaje.Responsable)) pesaje.Responsable = "Operador de campo";
                if (string.IsNullOrWhiteSpace(pesaje.OrigenPesaje)) pesaje.OrigenPesaje = "manual";
                pesaje.CreadoEn = ahora;
                pesaje.VersionRegistro = 1;
                pesaje.EliminadoEn = null;
                break;

            case GenealogiaAnimal gen:
                gen.IdGenealogia = targetId;
                gen.IdAutor = idUsuarioJwt;
                gen.Observaciones = string.IsNullOrWhiteSpace(gen.Observaciones) ? null : gen.Observaciones.Trim();
                gen.CreadoEn = ahora;
                gen.VersionRegistro = 1;
                gen.EliminadoEn = null;
                break;

            case EventoReproductivo er:
                er.IdEventoReproductivo = targetId;
                er.IdAutor = idUsuarioJwt;
                er.Tipo = er.Tipo?.Trim() ?? string.Empty;
                er.Fecha = er.Fecha == default ? ahora : ApiProblemResults.EnsureUtc(er.Fecha);
                er.Resultado = string.IsNullOrWhiteSpace(er.Resultado) ? null : er.Resultado.Trim();
                er.Observaciones = string.IsNullOrWhiteSpace(er.Observaciones) ? null : er.Observaciones.Trim();
                er.CreadoEn = ahora;
                er.VersionRegistro = 1;
                er.EliminadoEn = null;
                break;
        }
    }

    private static Guid GetEntityPrimaryKeyGuid(string entidadNormalizada, object entity) =>
        entity switch
        {
            Animal a => a.IdAnimal,
            Lote l => l.IdLote,
            Rancho r => r.IdRancho,
            EventoSanitario e => e.IdEventoSanitario,
            Tratamiento t => t.IdTratamiento,
            Recordatorio rec => rec.IdRecordatorio,
            Alimentacion al => al.IdAlimentacion,
            MovimientoAnimal mov => mov.IdMovimiento,
            Pesaje pesaje => pesaje.IdPesaje,
            GenealogiaAnimal gen => gen.IdGenealogia,
            EventoReproductivo er => er.IdEventoReproductivo,
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
            Pesaje pesaje => pesaje.VersionRegistro,
            GenealogiaAnimal gen => gen.VersionRegistro,
            EventoReproductivo er => er.VersionRegistro,
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
            case Pesaje pesaje: pesaje.VersionRegistro = version; break;
            case GenealogiaAnimal gen: gen.VersionRegistro = version; break;
            case EventoReproductivo er: er.VersionRegistro = version; break;
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
            Pesaje pesaje => pesaje.EliminadoEn,
            GenealogiaAnimal gen => gen.EliminadoEn,
            EventoReproductivo er => er.EliminadoEn,
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
            case Pesaje pesaje: pesaje.EliminadoEn = deletedAt; break;
            case GenealogiaAnimal gen: gen.EliminadoEn = deletedAt; break;
            case EventoReproductivo er: er.EliminadoEn = deletedAt; break;
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
            "pesaje" or "pesajes" or "weighing" or "weighings" => nameof(Pesaje),
            "genealogia" or "genealogias" or "genealogiaanimal" or "genealogy" => nameof(GenealogiaAnimal),
            "eventoreproductivo" or "eventos-reproductivos" or "reproductionrecords" => nameof(EventoReproductivo),
            _ => null
        };
    }

    private static string? NormalizeOperation(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        return input.Trim().ToUpperInvariant() switch
        {
            "CREAR" or "CREATE" or "ALTA" => "Crear",
            "ACTUALIZAR" or "UPDATE" or "MODIFICAR" => "Actualizar",
            "ELIMINAR" or "DELETE" or "BAJA" => "Eliminar",
            _ => null
        };
    }

    public static string ComputeRequestHash(
        Guid idUsuarioJwt,
        Guid idRancho,
        string idDispositivo,
        string entidadNormalizada,
        Guid? idRegistro,
        string operacionNormalizada,
        long? versionBase,
        JsonElement payload)
    {
        var opCanonical = NormalizeOperation(operacionNormalizada) ?? operacionNormalizada;
        var canonicalPayload = CanonicalizeJson(payload);
        var idRegStr = idRegistro.HasValue && idRegistro.Value != Guid.Empty
            ? idRegistro.Value.ToString("D")
            : string.Empty;
        var verStr = versionBase?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;

        var canonical = $"{idUsuarioJwt:D}|{idRancho:D}|{idDispositivo.Trim()}|{entidadNormalizada}|{idRegStr}|{opCanonical}|{verStr}|{canonicalPayload}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexStringLower(bytes);
    }

    public static string CanonicalizeJson(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Undefined:
            case JsonValueKind.Null:
                return "null";

            case JsonValueKind.True:
                return "true";

            case JsonValueKind.False:
                return "false";

            case JsonValueKind.Number:
                if (element.TryGetDecimal(out var dec))
                    return dec.ToString(CultureInfo.InvariantCulture);
                return element.GetRawText();

            case JsonValueKind.String:
                return JsonSerializer.Serialize(element.GetString());

            case JsonValueKind.Array:
            {
                var items = new List<string>();
                foreach (var item in element.EnumerateArray())
                {
                    items.Add(CanonicalizeJson(item));
                }
                return $"[{string.Join(",", items)}]";
            }

            case JsonValueKind.Object:
            {
                var sortedProps = element.EnumerateObject()
                    .OrderBy(p => p.Name, StringComparer.Ordinal)
                    .Select(p => $"{JsonSerializer.Serialize(p.Name)}:{CanonicalizeJson(p.Value)}");
                return $"{{{string.Join(",", sortedProps)}}}";
            }

            default:
                return element.GetRawText();
        }
    }
}
