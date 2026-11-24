namespace FarmBovi.Api.Services.BoviScale;

/// <summary>
/// Configuración del servicio externo en Python para estimación de peso BoviScale.
/// Debe configurarse mediante User Secrets (desarrollo) o variables de entorno
/// (<c>BoviScale__BaseUrl</c>, <c>BoviScale__ApiKey</c>) y jamás exponerse al navegador.
/// </summary>
public sealed class BoviScalePythonOptions
{
    public const string SectionName = "BoviScale";

    /// <summary>URL base interna del servicio Python (ej. <c>http://boviscale-ml:8000</c>).</summary>
    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>Ruta del endpoint de inferencia en Python.</summary>
    public string AnalyzeEndpoint { get; set; } = "/api/v1/estimate-weight";

    /// <summary>Nombre del encabezado HTTP para autenticación servicio-a-servicio.</summary>
    public string ApiKeyHeaderName { get; set; } = "X-Api-Key";

    /// <summary>Secreto servicio-a-servicio (solo en User Secrets o variable de entorno).</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>Tiempo máximo de espera por solicitud hacia Python en segundos.</summary>
    public int TimeoutSeconds { get; set; } = 25;

    /// <summary>Límite inferior plausible del peso estimado en kilogramos (&gt; 0).</summary>
    public decimal MinValidWeightKg { get; set; } = 15m;

    /// <summary>Límite superior plausible del peso estimado en kilogramos.</summary>
    public decimal MaxValidWeightKg { get; set; } = 2000m;

    /// <summary>Unidad de medida canónica aceptada desde la API Python.</summary>
    public string AllowedWeightUnit { get; set; } = "kg";

    /// <summary>Formato de representación de la imagen dentro del JSON acordado (<c>base64</c>).</summary>
    public string ImageTransportFormat { get; set; } = "base64";

    public TimeSpan EffectiveTimeout =>
        TimeSpan.FromSeconds(Math.Clamp(TimeoutSeconds <= 0 ? 25 : TimeoutSeconds, 1, 120));

    public decimal EffectiveMinWeightKg => MinValidWeightKg > 0 ? MinValidWeightKg : 1m;

    public decimal EffectiveMaxWeightKg =>
        MaxValidWeightKg > EffectiveMinWeightKg ? MaxValidWeightKg : 2500m;

    public string EffectiveWeightUnit =>
        string.IsNullOrWhiteSpace(AllowedWeightUnit) ? "kg" : AllowedWeightUnit.Trim().ToLowerInvariant();
}
