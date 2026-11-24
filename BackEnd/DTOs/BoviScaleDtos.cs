using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace FarmBovi.Api.DTOs;

/// <summary>
/// Solicitud autenticada desde el Frontend hacia el backend .NET de FarmBovi
/// para estimar el peso de un bovino mediante la API Python de BoviScale.
/// </summary>
public sealed class SolicitarEstimacionPesoRequestDto
{
    /// <summary>
    /// Identificador único de solicitud para garantizar idempotencia ante reintentos.
    /// </summary>
    [Required]
    public Guid IdSolicitud { get; set; }

    [Required]
    public Guid IdAnimal { get; set; }

    /// <summary>
    /// Rancho declarado opcionalmente; si se envía, se valida que coincida con el rancho real del animal.
    /// </summary>
    public Guid? IdRancho { get; set; }

    /// <summary>
    /// Identificador del registro <c>ArchivoMultimedia</c> previamente cargado y validado en el servidor.
    /// </summary>
    [Required]
    public Guid IdArchivo { get; set; }

    public DateTime? FechaPesaje { get; set; }

    [MaxLength(180)]
    public string? Responsable { get; set; }

    [MaxLength(60)]
    public string? AnguloCaptura { get; set; }

    [Range(10, 2000)]
    public decimal? DistanciaEstimadaCm { get; set; }

    [MaxLength(350)]
    public string? Observaciones { get; set; }
}

/// <summary>
/// Respuesta devuelta al Frontend tras procesar la estimación con Python y persistir el <c>Pesaje</c>.
/// Nunca expone URLs internas ni credenciales del servicio Python.
/// </summary>
public sealed record EstimacionPesoBoviScaleResponseDto(
    Guid IdPesaje,
    Guid IdSolicitud,
    Guid IdRancho,
    Guid IdAnimal,
    Guid? IdArchivoMultimedia,
    decimal PesoEstimadoKg,
    string UnidadPeso,
    decimal? ConfianzaModelo,
    string? VersionModelo,
    string? Observaciones,
    string OrigenPesaje,
    string FuenteBascula,
    string Responsable,
    DateTime FechaPesaje,
    DateTime CreadoEn,
    long VersionRegistro,
    bool DuplicadoIgnorado,
    int? TiempoProcesamientoMs);

// ---- Contrato JSON específico entre .NET 10 y la API Python de BoviScale ----

public sealed record PythonAnimalContextDto(
    [property: JsonPropertyName("breed")] string Breed,
    [property: JsonPropertyName("sex")] string Sex,
    [property: JsonPropertyName("age_months")] int? AgeMonths);

public sealed record PythonImagePayloadDto(
    [property: JsonPropertyName("format")] string Format,
    [property: JsonPropertyName("mime_type")] string MimeType,
    [property: JsonPropertyName("data")] string Data);

public sealed record PythonImageMetadataDto(
    [property: JsonPropertyName("size_bytes")] long SizeBytes,
    [property: JsonPropertyName("checksum_sha256")] string? ChecksumSha256,
    [property: JsonPropertyName("captured_at_utc")] DateTime CapturedAtUtc,
    [property: JsonPropertyName("capture_angle")] string? CaptureAngle,
    [property: JsonPropertyName("estimated_distance_cm")] decimal? EstimatedDistanceCm);

public sealed record PythonEstimateWeightRequestDto(
    [property: JsonPropertyName("request_id")] Guid RequestId,
    [property: JsonPropertyName("ranch_id")] Guid RanchId,
    [property: JsonPropertyName("animal_id")] Guid AnimalId,
    [property: JsonPropertyName("media_id")] Guid MediaId,
    [property: JsonPropertyName("animal_context")] PythonAnimalContextDto AnimalContext,
    [property: JsonPropertyName("image")] PythonImagePayloadDto Image,
    [property: JsonPropertyName("image_metadata")] PythonImageMetadataDto ImageMetadata);

public sealed record PythonWeightRangeDto(
    [property: JsonPropertyName("min")] decimal? Min,
    [property: JsonPropertyName("max")] decimal? Max);

public sealed record PythonErrorDetailDto(
    [property: JsonPropertyName("code")] string? Code,
    [property: JsonPropertyName("message")] string? Message,
    [property: JsonPropertyName("retryable")] bool? Retryable);

public sealed record PythonEstimateWeightResponseDto(
    [property: JsonPropertyName("request_id")] Guid? RequestId,
    [property: JsonPropertyName("animal_id")] Guid? AnimalId,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("estimated_weight")] decimal? EstimatedWeight,
    [property: JsonPropertyName("weight_unit")] string? WeightUnit,
    [property: JsonPropertyName("confidence")] decimal? Confidence,
    [property: JsonPropertyName("weight_range_kg")] PythonWeightRangeDto? WeightRangeKg,
    [property: JsonPropertyName("model_version")] string? ModelVersion,
    [property: JsonPropertyName("processing_time_ms")] int? ProcessingTimeMs,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("processed_at_utc")] DateTime? ProcessedAtUtc,
    [property: JsonPropertyName("error")] PythonErrorDetailDto? Error);
