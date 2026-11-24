using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.DTOs;
using Microsoft.Extensions.Options;

namespace FarmBovi.Api.Services.BoviScale;

/// <summary>
/// Implementación HTTP sobre <see cref="IHttpClientFactory"/> para comunicarse con la API Python de BoviScale.
/// - Serializa/deserializa JSON estrictamente tipado.
/// - Aplica cancelación combinada (cliente + timeout configurado).
/// - Valida peso estimado, unidad de medida y rango configurado.
/// - Emite logs técnicos estructurados sin registrar nunca imágenes Base64, URLs internas ni secretos.
/// </summary>
public sealed class BoviScalePythonClient(
    HttpClient httpClient,
    IOptions<BoviScalePythonOptions> optionsAccessor,
    ILogger<BoviScalePythonClient> logger) : IBoviScalePythonClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<PythonEstimationCallResult> EstimateWeightAsync(
        PythonEstimateWeightRequestDto request,
        CancellationToken ct = default)
    {
        var opts = optionsAccessor.Value;

        if (!TryBuildTargetUri(opts, out var targetUri))
        {
            logger.LogWarning(
                "BoviScale Python no configurado correctamente. RequestId={RequestId} AnimalId={AnimalId} RanchId={RanchId}",
                request.RequestId,
                request.AnimalId,
                request.RanchId);

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.NotConfigured,
                "El servicio de estimación de peso BoviScale no está configurado en el servidor.");
        }

        var timeout = opts.EffectiveTimeout;
        var sw = Stopwatch.StartNew();

        logger.LogInformation(
            "Enviando solicitud a API Python BoviScale. RequestId={RequestId} RanchId={RanchId} AnimalId={AnimalId} MediaId={MediaId} ImageBytes={ImageBytes} Format={Format}",
            request.RequestId,
            request.RanchId,
            request.AnimalId,
            request.MediaId,
            request.ImageMetadata.SizeBytes,
            request.Image.Format);

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, targetUri);
        httpRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        httpRequest.Headers.TryAddWithoutValidation("X-Request-Id", request.RequestId.ToString());
        httpRequest.Headers.TryAddWithoutValidation("X-Idempotency-Key", request.RequestId.ToString());

        if (!string.IsNullOrWhiteSpace(opts.ApiKey) && !string.IsNullOrWhiteSpace(opts.ApiKeyHeaderName))
        {
            httpRequest.Headers.TryAddWithoutValidation(opts.ApiKeyHeaderName.Trim(), opts.ApiKey);
        }

        var payloadJson = JsonSerializer.Serialize(request, JsonOptions);
        httpRequest.Content = new StringContent(payloadJson, Encoding.UTF8, "application/json");

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(
                httpRequest,
                HttpCompletionOption.ResponseHeadersRead,
                timeoutCts.Token);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            sw.Stop();
            logger.LogWarning(
                "Solicitud BoviScale cancelada por el cliente. RequestId={RequestId} ElapsedMs={ElapsedMs}",
                request.RequestId,
                sw.ElapsedMilliseconds);
            throw;
        }
        catch (OperationCanceledException)
        {
            sw.Stop();
            logger.LogWarning(
                "Tiempo de espera agotado al contactar API Python BoviScale. RequestId={RequestId} AnimalId={AnimalId} TimeoutSec={TimeoutSec} ElapsedMs={ElapsedMs}",
                request.RequestId,
                request.AnimalId,
                timeout.TotalSeconds,
                sw.ElapsedMilliseconds);

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.Timeout,
                "Se agotó el tiempo de espera al contactar el servicio de estimación de peso.");
        }
        catch (HttpRequestException ex)
        {
            sw.Stop();
            logger.LogError(
                "Error de conexión con API Python BoviScale. RequestId={RequestId} AnimalId={AnimalId} StatusCode={StatusCode} ElapsedMs={ElapsedMs} ErrorType={ErrorType}",
                request.RequestId,
                request.AnimalId,
                ex.StatusCode,
                sw.ElapsedMilliseconds,
                ex.GetType().Name);

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.ConnectionError,
                "No fue posible establecer conexión con el servicio de estimación de peso.");
        }

        using (response)
        {
            string rawBody;
            try
            {
                rawBody = await response.Content.ReadAsStringAsync(timeoutCts.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                sw.Stop();
                logger.LogWarning(
                    "Timeout leyendo cuerpo de respuesta de API Python BoviScale. RequestId={RequestId} ElapsedMs={ElapsedMs}",
                    request.RequestId,
                    sw.ElapsedMilliseconds);

                return PythonEstimationCallResult.Failure(
                    PythonEstimationErrorKind.Timeout,
                    "Se agotó el tiempo de espera al recibir la respuesta del servicio de estimación.");
            }

            sw.Stop();

            if (!response.IsSuccessStatusCode)
            {
                return HandleUpstreamHttpError(request, response, rawBody, sw.ElapsedMilliseconds);
            }

            if (string.IsNullOrWhiteSpace(rawBody))
            {
                logger.LogWarning(
                    "API Python BoviScale devolvió respuesta vacía con HTTP {StatusCode}. RequestId={RequestId} ElapsedMs={ElapsedMs}",
                    (int)response.StatusCode,
                    request.RequestId,
                    sw.ElapsedMilliseconds);

                return PythonEstimationCallResult.Failure(
                    PythonEstimationErrorKind.InvalidResponse,
                    "El servicio de estimación devolvió una respuesta vacía.");
            }

            PythonEstimateWeightResponseDto? parsed;
            try
            {
                parsed = JsonSerializer.Deserialize<PythonEstimateWeightResponseDto>(rawBody, JsonOptions);
            }
            catch (JsonException)
            {
                logger.LogWarning(
                    "API Python BoviScale devolvió JSON inválido. RequestId={RequestId} HttpStatus={StatusCode} ElapsedMs={ElapsedMs}",
                    request.RequestId,
                    (int)response.StatusCode,
                    sw.ElapsedMilliseconds);

                return PythonEstimationCallResult.Failure(
                    PythonEstimationErrorKind.InvalidResponse,
                    "El servicio de estimación devolvió una respuesta JSON inválida.");
            }

            if (parsed is null)
            {
                return PythonEstimationCallResult.Failure(
                    PythonEstimationErrorKind.InvalidResponse,
                    "No se pudo interpretar la respuesta del servicio de estimación.");
            }

            return ValidateAndMapSuccessResponse(request, parsed, opts, sw.ElapsedMilliseconds);
        }
    }

    private PythonEstimationCallResult HandleUpstreamHttpError(
        PythonEstimateWeightRequestDto request,
        HttpResponseMessage response,
        string rawBody,
        long elapsedMs)
    {
        var status = response.StatusCode;
        var parsedError = TryParseErrorBody(rawBody);

        logger.LogWarning(
            "API Python BoviScale respondió error HTTP {StatusCode}. RequestId={RequestId} AnimalId={AnimalId} ErrorCode={ErrorCode} ElapsedMs={ElapsedMs}",
            (int)status,
            request.RequestId,
            request.AnimalId,
            parsedError?.Code ?? "NONE",
            elapsedMs);

        if (status == HttpStatusCode.TooManyRequests)
        {
            var retryAfterSeconds = ParseRetryAfterSeconds(response.Headers.RetryAfter);
            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.RateLimited,
                "El servicio de estimación alcanzó su límite temporal de solicitudes. Intenta nuevamente más tarde.",
                parsedError?.Code ?? "RATE_LIMITED",
                retryAfterSeconds);
        }

        if (status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            logger.LogError(
                "Error de autenticación entre FarmBovi y API Python BoviScale (HTTP {StatusCode}). Verifica BoviScale:ApiKey. RequestId={RequestId}",
                (int)status,
                request.RequestId);

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.UpstreamAuthError,
                "Error de autenticación interna con el servicio de estimación de peso.");
        }

        if (status is HttpStatusCode.UnprocessableEntity or HttpStatusCode.BadRequest)
        {
            var detail = !string.IsNullOrWhiteSpace(parsedError?.Message)
                ? parsedError!.Message!.Trim()
                : "El modelo de estimación no pudo procesar la fotografía enviada.";

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.ModelRejected,
                detail,
                parsedError?.Code);
        }

        if (status == HttpStatusCode.GatewayTimeout)
        {
            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.Timeout,
                "El servicio de estimación excedió el tiempo máximo de procesamiento.",
                parsedError?.Code);
        }

        return PythonEstimationCallResult.Failure(
            PythonEstimationErrorKind.UpstreamUnavailable,
            "El servicio de estimación de peso no está disponible temporalmente.",
            parsedError?.Code);
    }

    private PythonEstimationCallResult ValidateAndMapSuccessResponse(
        PythonEstimateWeightRequestDto request,
        PythonEstimateWeightResponseDto parsed,
        BoviScalePythonOptions opts,
        long elapsedMs)
    {
        if (parsed.RequestId.HasValue && parsed.RequestId.Value != Guid.Empty &&
            parsed.RequestId.Value != request.RequestId)
        {
            logger.LogWarning(
                "Desfase de request_id en respuesta Python. Expected={Expected} Received={Received}",
                request.RequestId,
                parsed.RequestId.Value);

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.InvalidResponse,
                "La respuesta del servicio de estimación no corresponde a la solicitud enviada.");
        }

        var status = (parsed.Status ?? string.Empty).Trim().ToLowerInvariant();
        if (status != "completed")
        {
            var reason = !string.IsNullOrWhiteSpace(parsed.Error?.Message)
                ? parsed.Error!.Message!.Trim()
                : $"El servicio de estimación no completó el procesamiento (estado: '{parsed.Status ?? "desconocido"}').";

            var kind = status is "rejected_image" or "rejected"
                ? PythonEstimationErrorKind.ModelRejected
                : PythonEstimationErrorKind.InvalidResponse;

            logger.LogWarning(
                "API Python BoviScale devolvió estado no completado. RequestId={RequestId} Status={Status} ErrorCode={ErrorCode} ElapsedMs={ElapsedMs}",
                request.RequestId,
                parsed.Status ?? "null",
                parsed.Error?.Code ?? "NONE",
                elapsedMs);

            return PythonEstimationCallResult.Failure(kind, reason, parsed.Error?.Code);
        }

        var expectedUnit = opts.EffectiveWeightUnit;
        var receivedUnit = (parsed.WeightUnit ?? string.Empty).Trim().ToLowerInvariant();
        if (!string.Equals(receivedUnit, expectedUnit, StringComparison.OrdinalIgnoreCase))
        {
            logger.LogWarning(
                "Unidad de peso inválida recibida desde API Python. RequestId={RequestId} ExpectedUnit={Expected} ReceivedUnit={Received}",
                request.RequestId,
                expectedUnit,
                parsed.WeightUnit ?? "null");

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.InvalidWeight,
                $"La unidad de peso devuelta ('{parsed.WeightUnit ?? "vacía"}') no es válida. Se esperaba '{expectedUnit}'.");
        }

        if (!parsed.EstimatedWeight.HasValue)
        {
            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.InvalidWeight,
                "El servicio de estimación no devolvió un peso estimado.");
        }

        var weight = parsed.EstimatedWeight.Value;
        var minWeight = opts.EffectiveMinWeightKg;
        var maxWeight = opts.EffectiveMaxWeightKg;
        if (weight <= 0 || weight < minWeight || weight > maxWeight)
        {
            logger.LogWarning(
                "Peso estimado fuera de límites configurados. RequestId={RequestId} AnimalId={AnimalId} Weight={Weight} Min={Min} Max={Max}",
                request.RequestId,
                request.AnimalId,
                weight,
                minWeight,
                maxWeight);

            return PythonEstimationCallResult.Failure(
                PythonEstimationErrorKind.InvalidWeight,
                $"El peso estimado devuelto ({weight:0.##} {expectedUnit}) está fuera del rango válido configurado ({minWeight:0.##}–{maxWeight:0.##} {expectedUnit}).");
        }

        decimal? normalizedConfidence = null;
        if (parsed.Confidence.HasValue)
        {
            if (parsed.Confidence.Value < 0m || parsed.Confidence.Value > 1m)
            {
                logger.LogWarning(
                    "Confianza fuera de rango [0,1] recibida desde API Python. RequestId={RequestId} Confidence={Confidence}",
                    request.RequestId,
                    parsed.Confidence.Value);

                return PythonEstimationCallResult.Failure(
                    PythonEstimationErrorKind.InvalidResponse,
                    "El valor de confianza devuelto por el modelo está fuera del rango válido [0, 1].");
            }
            normalizedConfidence = decimal.Round(parsed.Confidence.Value, 4, MidpointRounding.AwayFromZero);
        }

        logger.LogInformation(
            "Estimación BoviScale completada correctamente. RequestId={RequestId} RanchId={RanchId} AnimalId={AnimalId} WeightKg={WeightKg} ModelVersion={ModelVersion} ElapsedMs={ElapsedMs}",
            request.RequestId,
            request.RanchId,
            request.AnimalId,
            weight,
            parsed.ModelVersion ?? "desconocida",
            elapsedMs);

        return PythonEstimationCallResult.Success(new PythonEstimationSuccess(
            EstimatedWeightKg: decimal.Round(weight, 3, MidpointRounding.AwayFromZero),
            WeightUnit: expectedUnit,
            Confidence: normalizedConfidence,
            ModelVersion: string.IsNullOrWhiteSpace(parsed.ModelVersion) ? null : parsed.ModelVersion.Trim(),
            Notes: string.IsNullOrWhiteSpace(parsed.Notes) ? null : parsed.Notes.Trim(),
            ProcessingTimeMs: parsed.ProcessingTimeMs));
    }

    private static bool TryBuildTargetUri(BoviScalePythonOptions opts, out Uri targetUri)
    {
        targetUri = null!;
        if (string.IsNullOrWhiteSpace(opts.BaseUrl))
            return false;

        if (!Uri.TryCreate(opts.BaseUrl.Trim(), UriKind.Absolute, out var baseUri) ||
            (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
        {
            return false;
        }

        var endpoint = string.IsNullOrWhiteSpace(opts.AnalyzeEndpoint)
            ? "/api/v1/estimate-weight"
            : opts.AnalyzeEndpoint.Trim();

        if (!endpoint.StartsWith('/'))
            endpoint = "/" + endpoint;

        var normalizedBase = new Uri(baseUri.AbsoluteUri.TrimEnd('/') + "/");
        return Uri.TryCreate(normalizedBase, endpoint.TrimStart('/'), out targetUri!);
    }

    private static PythonErrorDetailDto? TryParseErrorBody(string rawBody)
    {
        if (string.IsNullOrWhiteSpace(rawBody)) return null;
        try
        {
            var envelope = JsonSerializer.Deserialize<PythonEstimateWeightResponseDto>(rawBody, JsonOptions);
            if (envelope?.Error is not null)
                return envelope.Error;

            using var doc = JsonDocument.Parse(rawBody);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                string? code = doc.RootElement.TryGetProperty("code", out var cProp) && cProp.ValueKind == JsonValueKind.String
                    ? cProp.GetString()
                    : null;
                string? message = null;
                if (doc.RootElement.TryGetProperty("message", out var mProp) && mProp.ValueKind == JsonValueKind.String)
                    message = mProp.GetString();
                else if (doc.RootElement.TryGetProperty("detail", out var dProp) && dProp.ValueKind == JsonValueKind.String)
                    message = dProp.GetString();

                if (code is not null || message is not null)
                    return new PythonErrorDetailDto(code, message, null);
            }
        }
        catch (JsonException)
        {
            // El cuerpo de error no es JSON estructurado
        }

        return null;
    }

    private static int? ParseRetryAfterSeconds(RetryConditionHeaderValue? header)
    {
        if (header is null) return null;
        if (header.Delta.HasValue)
            return Math.Max(1, (int)Math.Ceiling(header.Delta.Value.TotalSeconds));
        if (header.Date.HasValue)
            return Math.Max(1, (int)Math.Ceiling((header.Date.Value - DateTimeOffset.UtcNow).TotalSeconds));
        return null;
    }
}
