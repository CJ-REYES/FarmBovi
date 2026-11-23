using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace FarmBovi.Api.DTOs;

public sealed record RegisterRequest(
    [Required, StringLength(120, MinimumLength = 2)] string Nombre,
    [Required, EmailAddress, StringLength(254)] string Correo,
    [Required, StringLength(200, MinimumLength = 8)] string Contrasena);

public sealed record UpdateProfileRequest(
    [Required, StringLength(120, MinimumLength = 2)] string Nombre,
    [Required, EmailAddress, StringLength(254)] string Correo);

public sealed record ChangePasswordRequest(
    [Required, StringLength(200)] string ContrasenaActual,
    [Required, StringLength(200, MinimumLength = 8)] string NuevaContrasena);

public sealed record UserConfigDto(
    string UnidadPeso = "kg",
    int DiasAvisoAlertas = 7,
    bool SincronizacionAutomatica = true,
    string FormatoFecha = "dd/MM/yyyy",
    Guid? RanchoPredeterminadoId = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static UserConfigDto Default => new();

    public static UserConfigDto ParseOrDefault(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Default;

        try
        {
            var parsed = JsonSerializer.Deserialize<UserConfigDto>(json, JsonOptions);
            return parsed is null ? Default : Normalize(parsed);
        }
        catch (JsonException)
        {
            return Default;
        }
    }

    public static (bool IsValid, string? Error, UserConfigDto Normalized) ValidateAndNormalize(UserConfigDto? input)
    {
        if (input is null)
            return (false, "La configuración es obligatoria.", Default);

        var unidad = (input.UnidadPeso ?? "kg").Trim().ToLowerInvariant();
        if (unidad is not ("kg" or "lb"))
            return (false, "La unidad de peso debe ser 'kg' o 'lb'.", Default);

        if (input.DiasAvisoAlertas is < 1 or > 90)
            return (false, "Los días de anticipación para alertas deben estar entre 1 y 90.", Default);

        var formato = (input.FormatoFecha ?? "dd/MM/yyyy").Trim();
        if (formato is not ("dd/MM/yyyy" or "yyyy-MM-dd"))
            return (false, "El formato de fecha debe ser 'dd/MM/yyyy' o 'yyyy-MM-dd'.", Default);

        return (true, null, new UserConfigDto(
            UnidadPeso: unidad,
            DiasAvisoAlertas: input.DiasAvisoAlertas,
            SincronizacionAutomatica: input.SincronizacionAutomatica,
            FormatoFecha: formato,
            RanchoPredeterminadoId: input.RanchoPredeterminadoId == Guid.Empty ? null : input.RanchoPredeterminadoId));
    }

    public static UserConfigDto Normalize(UserConfigDto input)
    {
        var (_, _, normalized) = ValidateAndNormalize(input);
        return normalized;
    }

    public string ToJson() => JsonSerializer.Serialize(Normalize(this), JsonOptions);
}
