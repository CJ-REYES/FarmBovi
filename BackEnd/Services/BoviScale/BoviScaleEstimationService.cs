using System.Collections.Concurrent;
using System.Data.Common;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FarmBovi.Api.Services.BoviScale;

/// <summary>
/// Coordina bloqueos ligeros en memoria por <c>IdSolicitud</c> para evitar que reintentos
/// concurrentes invoquen dos veces a la API Python antes de que el primer resultado se persista en BD.
/// </summary>
public sealed class BoviScaleIdempotencyCoordinator
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

    public async Task<IDisposable> AcquireAsync(Guid requestId, CancellationToken ct)
    {
        var semaphore = _locks.GetOrAdd(requestId, _ => new SemaphoreSlim(1, 1));
        await semaphore.WaitAsync(ct);
        return new Releaser(this, requestId, semaphore);
    }

    private void Release(Guid requestId, SemaphoreSlim semaphore)
    {
        semaphore.Release();
        if (semaphore.CurrentCount == 1)
        {
            _locks.TryRemove(new KeyValuePair<Guid, SemaphoreSlim>(requestId, semaphore));
        }
    }

    private sealed class Releaser(
        BoviScaleIdempotencyCoordinator owner,
        Guid requestId,
        SemaphoreSlim semaphore) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                owner.Release(requestId, semaphore);
            }
        }
    }
}

public sealed record BoviScaleServiceOutcome(
    int StatusCode,
    EstimacionPesoBoviScaleResponseDto? Data = null,
    string? ErrorTitle = null,
    string? ErrorDetail = null,
    string? ValidationField = null,
    int? RetryAfterSeconds = null)
{
    public bool IsSuccess => StatusCode is >= 200 and < 300;
}

/// <summary>
/// Orquesta la estimación de peso bovino BoviScale:
/// valida permisos por rancho, pertenencia animal/fotografía, garantiza idempotencia por <c>IdSolicitud</c>,
/// lee la fotografía privada desde <see cref="IMediaStorageProvider"/>, invoca a la API Python externa y
/// persiste únicamente resultados válidos en la tabla existente <c>Pesaje</c>.
/// </summary>
public sealed class BoviScaleEstimationService(
    FarmDbContext db,
    RanchAccessService access,
    IMediaStorageProvider mediaStorage,
    IBoviScalePythonClient pythonClient,
    BoviScaleIdempotencyCoordinator idempotencyCoordinator,
    IOptions<BoviScalePythonOptions> optionsAccessor,
    ILogger<BoviScaleEstimationService> logger)
{
    private const string OrigenBoviScaleIa = "boviscale_ia";

    public async Task<BoviScaleServiceOutcome> GetBySolicitudAsync(
        Guid userId,
        Guid idSolicitud,
        CancellationToken ct = default)
    {
        if (idSolicitud == Guid.Empty)
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status400BadRequest,
                ErrorTitle: "Error de validación.",
                ErrorDetail: "El identificador de solicitud (idSolicitud) no es válido.",
                ValidationField: "idSolicitud");
        }

        var existing = await (from p in db.Pesajes.AsNoTracking()
                              join a in db.Animales.AsNoTracking() on p.IdAnimal equals a.IdAnimal
                              where p.IdSolicitud == idSolicitud
                              select new { Pesaje = p, a.IdRancho })
            .FirstOrDefaultAsync(ct);

        if (existing is null)
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status404NotFound,
                ErrorTitle: "Recurso no encontrado.",
                ErrorDetail: "No existe una estimación registrada para el identificador de solicitud indicado.");
        }

        if (!await access.CanAccessAsync(userId, existing.IdRancho, ct))
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status403Forbidden,
                ErrorTitle: "Acceso denegado.",
                ErrorDetail: "No tienes permisos sobre el rancho de esta estimación.");
        }

        return new BoviScaleServiceOutcome(
            StatusCodes.Status200OK,
            Data: ToResponseDto(existing.Pesaje, existing.IdRancho, duplicadoIgnorado: false, processingTimeMs: null));
    }

    public async Task<BoviScaleServiceOutcome> EstimateAndRecordAsync(
        Guid userId,
        SolicitarEstimacionPesoRequestDto request,
        CancellationToken ct = default)
    {
        if (request.IdSolicitud == Guid.Empty)
            return ValidationFail("El identificador de solicitud (idSolicitud) es obligatorio.", nameof(request.IdSolicitud));
        if (request.IdAnimal == Guid.Empty)
            return ValidationFail("El identificador del animal (idAnimal) es obligatorio.", nameof(request.IdAnimal));
        if (request.IdArchivo == Guid.Empty)
            return ValidationFail("El identificador del archivo multimedia (idArchivo) es obligatorio.", nameof(request.IdArchivo));
        if (request.IdRancho is { } rawRanch && rawRanch == Guid.Empty)
            return ValidationFail("El identificador del rancho (idRancho) no es válido.", nameof(request.IdRancho));

        // 1. Verificación rápida de idempotencia previa al bloqueo
        var earlyDuplicate = await TryResolveExistingBySolicitudAsync(userId, request, ct);
        if (earlyDuplicate is not null)
            return earlyDuplicate;

        // 2. Exclusión por IdSolicitud para evitar invocaciones duplicadas concurrentes a Python
        using var requestLock = await idempotencyCoordinator.AcquireAsync(request.IdSolicitud, ct);

        // Re-verificar en BD tras adquirir el bloqueo (doble chequeo)
        var duplicateAfterLock = await TryResolveExistingBySolicitudAsync(userId, request, ct);
        if (duplicateAfterLock is not null)
            return duplicateAfterLock;

        // 3. Validar existencia del animal y pertenencia al rancho autorizado
        var animal = await db.Animales.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAnimal == request.IdAnimal && a.EliminadoEn == null, ct);
        if (animal is null)
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status404NotFound,
                ErrorTitle: "Recurso no encontrado.",
                ErrorDetail: "El bovino indicado no existe o está eliminado.");
        }

        if (!await access.CanAccessAsync(userId, animal.IdRancho, ct))
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status403Forbidden,
                ErrorTitle: "Acceso denegado.",
                ErrorDetail: "No tienes membresía activa en el rancho al que pertenece este bovino.");
        }

        if (request.IdRancho.HasValue && request.IdRancho.Value != animal.IdRancho)
        {
            if (!await access.CanAccessAsync(userId, request.IdRancho.Value, ct))
            {
                return new BoviScaleServiceOutcome(
                    StatusCodes.Status403Forbidden,
                    ErrorTitle: "Acceso denegado.",
                    ErrorDetail: "No tienes permisos sobre el rancho especificado.");
            }

            return ValidationFail(
                "El bovino especificado no pertenece al rancho indicado.",
                nameof(request.IdAnimal));
        }

        // 4. Validar fotografía privada asociada al mismo rancho y animal
        var media = await db.ArchivosMultimedia.AsNoTracking()
            .FirstOrDefaultAsync(m => m.IdArchivo == request.IdArchivo, ct);
        if (media is null)
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status404NotFound,
                ErrorTitle: "Recurso no encontrado.",
                ErrorDetail: "La fotografía indicada no existe.");
        }

        if (!await access.CanAccessAsync(userId, media.IdRancho, ct))
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status403Forbidden,
                ErrorTitle: "Acceso denegado.",
                ErrorDetail: "No tienes permisos sobre el rancho propietario de la fotografía.");
        }

        if (media.EliminadoEn is not null ||
            !string.Equals(media.Estado, EstadosArchivoMultimedia.Disponible, StringComparison.OrdinalIgnoreCase))
        {
            return ValidationFail(
                "La fotografía seleccionada fue eliminada o no está disponible para análisis.",
                nameof(request.IdArchivo));
        }

        if (media.IdRancho != animal.IdRancho)
        {
            return ValidationFail(
                "La fotografía no pertenece al mismo rancho que el bovino seleccionado.",
                nameof(request.IdArchivo));
        }

        if (media.IdAnimal.HasValue && media.IdAnimal.Value != animal.IdAnimal)
        {
            return ValidationFail(
                "La fotografía seleccionada está asociada a otro bovino.",
                nameof(request.IdArchivo));
        }

        // 5. Leer binario privado desde IMediaStorageProvider y codificar según formato acordado
        var mediaStreamResult = await mediaStorage.OpenReadAsync(media.RutaArchivo, media.MimeType, ct);
        if (mediaStreamResult is null)
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status404NotFound,
                ErrorTitle: "Archivo binario no disponible.",
                ErrorDetail: "No se encontró el archivo binario de la fotografía en el almacenamiento privado.");
        }

        string encodedImageBase64;
        long actualImageBytes;
        await using (mediaStreamResult.Content)
        {
            using var ms = new MemoryStream(mediaStreamResult.Length > 0 && mediaStreamResult.Length <= int.MaxValue
                ? (int)mediaStreamResult.Length
                : 0);
            await mediaStreamResult.Content.CopyToAsync(ms, ct);
            var bytes = ms.ToArray();
            actualImageBytes = bytes.Length;
            if (actualImageBytes <= 0)
            {
                return ValidationFail(
                    "El archivo fotográfico almacenado está vacío y no puede analizarse.",
                    nameof(request.IdArchivo));
            }
            encodedImageBase64 = Convert.ToBase64String(bytes);
        }

        var opts = optionsAccessor.Value;
        var transportFormat = string.IsNullOrWhiteSpace(opts.ImageTransportFormat)
            ? "base64"
            : opts.ImageTransportFormat.Trim().ToLowerInvariant();

        var pythonRequest = new PythonEstimateWeightRequestDto(
            RequestId: request.IdSolicitud,
            RanchId: animal.IdRancho,
            AnimalId: animal.IdAnimal,
            MediaId: media.IdArchivo,
            AnimalContext: new PythonAnimalContextDto(
                Breed: animal.Raza,
                Sex: animal.Sexo,
                AgeMonths: CalculateAgeMonths(animal.FechaNacimiento)),
            Image: new PythonImagePayloadDto(
                Format: transportFormat,
                MimeType: media.MimeType,
                Data: encodedImageBase64),
            ImageMetadata: new PythonImageMetadataDto(
                SizeBytes: actualImageBytes,
                ChecksumSha256: media.ChecksumSha256,
                CapturedAtUtc: ApiProblemResults.EnsureUtc(media.FechaCaptura),
                CaptureAngle: NormalizeOptional(request.AnguloCaptura),
                EstimatedDistanceCm: request.DistanciaEstimadaCm));

        // 6. Invocar API Python externa (nunca simular ni inventar peso ante error)
        var pythonResult = await pythonClient.EstimateWeightAsync(pythonRequest, ct);
        if (!pythonResult.Ok || pythonResult.Data is null)
        {
            return MapPythonFailure(pythonResult);
        }

        var estimated = pythonResult.Data;

        // Doble validación de dominio antes de persistir Pesaje (Regla 14)
        var domainWeightError = FarmDomainValidationService.ValidatePesaje(estimated.EstimatedWeightKg);
        if (domainWeightError is not null ||
            estimated.EstimatedWeightKg < opts.EffectiveMinWeightKg ||
            estimated.EstimatedWeightKg > opts.EffectiveMaxWeightKg)
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status502BadGateway,
                ErrorTitle: "Respuesta inválida del modelo de estimación.",
                ErrorDetail: domainWeightError ?? "El peso devuelto por el modelo está fuera del rango permitido.");
        }

        // 7. Resolver nombre del responsable y persistir en la tabla existente Pesaje
        var userName = await db.Usuarios.AsNoTracking()
            .Where(u => u.IdUsuario == userId)
            .Select(u => u.Nombre)
            .FirstOrDefaultAsync(ct);

        var responsable = Truncate(
            !string.IsNullOrWhiteSpace(request.Responsable)
                ? request.Responsable.Trim()
                : !string.IsNullOrWhiteSpace(userName)
                    ? userName.Trim()
                    : "Operador de campo",
            180);

        var fuenteBascula = BuildFuenteBascula(estimated.ModelVersion);
        var observaciones = BuildObservaciones(request.Observaciones, estimated.Notes, estimated.Confidence);
        var fechaPesajeUtc = request.FechaPesaje.HasValue
            ? ApiProblemResults.EnsureUtc(request.FechaPesaje.Value)
            : ApiProblemResults.EnsureUtc(media.FechaCaptura);

        var pesaje = new Pesaje
        {
            IdPesaje = Guid.NewGuid(),
            IdAnimal = animal.IdAnimal,
            PesoRealKg = estimated.EstimatedWeightKg,
            Fecha = fechaPesajeUtc,
            FuenteBascula = fuenteBascula,
            Responsable = responsable,
            Observaciones = observaciones,
            OrigenPesaje = OrigenBoviScaleIa,
            IdSolicitud = request.IdSolicitud,
            IdArchivoMultimedia = media.IdArchivo,
            ConfianzaModelo = estimated.Confidence,
            VersionModelo = TruncateOptional(estimated.ModelVersion, 80),
            IdAutor = userId,
            CreadoEn = DateTime.UtcNow,
            VersionRegistro = 1,
            EliminadoEn = null
        };

        db.Pesajes.Add(pesaje);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            db.ChangeTracker.Clear();

            // Carrera concurrente entre múltiples instancias sobre índice único IdSolicitud
            try
            {
                var concurrentOutcome = await TryResolveExistingBySolicitudAsync(userId, request, ct);
                if (concurrentOutcome is not null)
                    return concurrentOutcome;
            }
            catch (Exception lookupEx)
            {
                logger.LogError(
                    "Fallo al verificar concurrencia tras error de persistencia BoviScale. RequestId={RequestId} ErrorType={ErrorType}",
                    request.IdSolicitud,
                    lookupEx.GetType().Name);
            }

            logger.LogError(
                "Error de persistencia en base de datos al registrar pesaje BoviScale. RequestId={RequestId} AnimalId={AnimalId} ErrorType={ErrorType}",
                request.IdSolicitud,
                animal.IdAnimal,
                ex.InnerException?.GetType().Name ?? ex.GetType().Name);

            return new BoviScaleServiceOutcome(
                StatusCodes.Status500InternalServerError,
                ErrorTitle: "Error de persistencia en base de datos.",
                ErrorDetail: "No fue posible guardar el pesaje estimado en la base de datos. Intenta nuevamente.");
        }
        catch (DbException ex)
        {
            db.ChangeTracker.Clear();

            logger.LogError(
                "Error de conexión con base de datos al registrar pesaje BoviScale. RequestId={RequestId} AnimalId={AnimalId} ErrorType={ErrorType}",
                request.IdSolicitud,
                animal.IdAnimal,
                ex.GetType().Name);

            return new BoviScaleServiceOutcome(
                StatusCodes.Status503ServiceUnavailable,
                ErrorTitle: "Base de datos no disponible.",
                ErrorDetail: "No fue posible guardar el pesaje estimado por un error temporal de base de datos.");
        }

        logger.LogInformation(
            "Pesaje BoviScale registrado en BD. IdPesaje={IdPesaje} RequestId={RequestId} RanchId={RanchId} AnimalId={AnimalId} PesoKg={PesoKg}",
            pesaje.IdPesaje,
            request.IdSolicitud,
            animal.IdRancho,
            animal.IdAnimal,
            pesaje.PesoRealKg);

        return new BoviScaleServiceOutcome(
            StatusCodes.Status201Created,
            Data: ToResponseDto(
                pesaje,
                animal.IdRancho,
                duplicadoIgnorado: false,
                processingTimeMs: estimated.ProcessingTimeMs));
    }

    private async Task<BoviScaleServiceOutcome?> TryResolveExistingBySolicitudAsync(
        Guid userId,
        SolicitarEstimacionPesoRequestDto request,
        CancellationToken ct)
    {
        var existing = await (from p in db.Pesajes.AsNoTracking()
                              join a in db.Animales.AsNoTracking() on p.IdAnimal equals a.IdAnimal
                              where p.IdSolicitud == request.IdSolicitud
                              select new { Pesaje = p, a.IdRancho })
            .FirstOrDefaultAsync(ct);

        if (existing is null)
            return null;

        if (!await access.CanAccessAsync(userId, existing.IdRancho, ct))
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status403Forbidden,
                ErrorTitle: "Acceso denegado.",
                ErrorDetail: "No tienes permisos sobre el rancho de la solicitud indicada.");
        }

        if (existing.Pesaje.EliminadoEn is not null ||
            existing.Pesaje.IdAnimal != request.IdAnimal ||
            (existing.Pesaje.IdArchivoMultimedia.HasValue && existing.Pesaje.IdArchivoMultimedia.Value != request.IdArchivo) ||
            (request.IdRancho.HasValue && request.IdRancho.Value != existing.IdRancho))
        {
            return new BoviScaleServiceOutcome(
                StatusCodes.Status409Conflict,
                ErrorTitle: "Conflicto de solicitud.",
                ErrorDetail: "El identificador de solicitud ya fue utilizado para otro animal, archivo o registro eliminado.");
        }

        logger.LogInformation(
            "Reintento idempotente BoviScale detectado; se devuelve pesaje existente sin invocar a Python. RequestId={RequestId} IdPesaje={IdPesaje}",
            request.IdSolicitud,
            existing.Pesaje.IdPesaje);

        return new BoviScaleServiceOutcome(
            StatusCodes.Status200OK,
            Data: ToResponseDto(
                existing.Pesaje,
                existing.IdRancho,
                duplicadoIgnorado: true,
                processingTimeMs: null));
    }

    private static BoviScaleServiceOutcome MapPythonFailure(PythonEstimationCallResult failure) =>
        failure.ErrorKind switch
        {
            PythonEstimationErrorKind.NotConfigured => new BoviScaleServiceOutcome(
                StatusCodes.Status503ServiceUnavailable,
                ErrorTitle: "Servicio BoviScale no configurado.",
                ErrorDetail: failure.ErrorMessage),

            PythonEstimationErrorKind.ConnectionError or PythonEstimationErrorKind.UpstreamUnavailable => new BoviScaleServiceOutcome(
                StatusCodes.Status503ServiceUnavailable,
                ErrorTitle: "Servicio de estimación no disponible.",
                ErrorDetail: failure.ErrorMessage),

            PythonEstimationErrorKind.Timeout => new BoviScaleServiceOutcome(
                StatusCodes.Status504GatewayTimeout,
                ErrorTitle: "Tiempo de espera agotado.",
                ErrorDetail: failure.ErrorMessage),

            PythonEstimationErrorKind.RateLimited => new BoviScaleServiceOutcome(
                StatusCodes.Status429TooManyRequests,
                ErrorTitle: "Límite de solicitudes alcanzado.",
                ErrorDetail: failure.ErrorMessage,
                RetryAfterSeconds: failure.RetryAfterSeconds),

            PythonEstimationErrorKind.ModelRejected => new BoviScaleServiceOutcome(
                StatusCodes.Status422UnprocessableEntity,
                ErrorTitle: "Fotografía no procesable por el modelo.",
                ErrorDetail: failure.ErrorMessage),

            _ => new BoviScaleServiceOutcome(
                StatusCodes.Status502BadGateway,
                ErrorTitle: "Respuesta inválida del servicio de estimación.",
                ErrorDetail: failure.ErrorMessage)
        };

    private static BoviScaleServiceOutcome ValidationFail(string detail, string field) =>
        new(StatusCodes.Status400BadRequest,
            ErrorTitle: "Error de validación.",
            ErrorDetail: detail,
            ValidationField: field);

    private static EstimacionPesoBoviScaleResponseDto ToResponseDto(
        Pesaje p,
        Guid idRancho,
        bool duplicadoIgnorado,
        int? processingTimeMs) =>
        new(
            IdPesaje: p.IdPesaje,
            IdSolicitud: p.IdSolicitud ?? Guid.Empty,
            IdRancho: idRancho,
            IdAnimal: p.IdAnimal,
            IdArchivoMultimedia: p.IdArchivoMultimedia,
            PesoEstimadoKg: p.PesoRealKg,
            UnidadPeso: "kg",
            ConfianzaModelo: p.ConfianzaModelo,
            VersionModelo: p.VersionModelo,
            Observaciones: p.Observaciones,
            OrigenPesaje: p.OrigenPesaje,
            FuenteBascula: p.FuenteBascula,
            Responsable: p.Responsable,
            FechaPesaje: p.Fecha,
            CreadoEn: p.CreadoEn,
            VersionRegistro: p.VersionRegistro,
            DuplicadoIgnorado: duplicadoIgnorado,
            TiempoProcesamientoMs: processingTimeMs);

    private static int? CalculateAgeMonths(DateTime? birthDate)
    {
        if (!birthDate.HasValue) return null;
        var today = DateTime.UtcNow.Date;
        var months = (today.Year - birthDate.Value.Year) * 12 + today.Month - birthDate.Value.Month;
        if (today.Day < birthDate.Value.Day) months--;
        return Math.Max(0, months);
    }

    private static string BuildFuenteBascula(string? modelVersion) =>
        string.IsNullOrWhiteSpace(modelVersion)
            ? "BoviScale IA"
            : Truncate($"BoviScale IA ({modelVersion.Trim()})", 150);

    private static string? BuildObservaciones(string? userNotes, string? modelNotes, decimal? confidence)
    {
        var parts = new List<string>(3);
        if (!string.IsNullOrWhiteSpace(userNotes))
            parts.Add(userNotes.Trim());
        if (!string.IsNullOrWhiteSpace(modelNotes))
            parts.Add($"Modelo: {modelNotes.Trim()}");
        if (confidence.HasValue)
            parts.Add($"Confianza: {confidence.Value * 100m:0.#}%");

        if (parts.Count == 0) return null;
        return Truncate(string.Join(" | ", parts), 500);
    }

    private static string? NormalizeOptional(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];

    private static string? TruncateOptional(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return Truncate(trimmed, maxLength);
    }
}
