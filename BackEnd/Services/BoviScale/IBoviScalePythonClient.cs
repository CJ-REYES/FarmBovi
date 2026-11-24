using FarmBovi.Api.DTOs;

namespace FarmBovi.Api.Services.BoviScale;

public enum PythonEstimationErrorKind
{
    None = 0,
    NotConfigured,
    ConnectionError,
    Timeout,
    RateLimited,
    UpstreamAuthError,
    ModelRejected,
    UpstreamUnavailable,
    InvalidResponse,
    InvalidWeight
}

public sealed record PythonEstimationSuccess(
    decimal EstimatedWeightKg,
    string WeightUnit,
    decimal? Confidence,
    string? ModelVersion,
    string? Notes,
    int? ProcessingTimeMs);

public sealed record PythonEstimationCallResult(
    bool Ok,
    PythonEstimationSuccess? Data,
    PythonEstimationErrorKind ErrorKind,
    string? ErrorMessage,
    string? UpstreamErrorCode = null,
    int? RetryAfterSeconds = null)
{
    public static PythonEstimationCallResult Success(PythonEstimationSuccess data) =>
        new(true, data, PythonEstimationErrorKind.None, null);

    public static PythonEstimationCallResult Failure(
        PythonEstimationErrorKind kind,
        string message,
        string? upstreamCode = null,
        int? retryAfterSeconds = null) =>
        new(false, null, kind, message, upstreamCode, retryAfterSeconds);
}

/// <summary>
/// Cliente especializado para invocar la API Python externa de estimación de peso BoviScale.
/// </summary>
public interface IBoviScalePythonClient
{
    Task<PythonEstimationCallResult> EstimateWeightAsync(
        PythonEstimateWeightRequestDto request,
        CancellationToken ct = default);
}
