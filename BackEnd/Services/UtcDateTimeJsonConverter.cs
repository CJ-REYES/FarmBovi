using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FarmBovi.Api.Services;

/// <summary>
/// Política unificada de fechas de la API:
/// - Fechas calendario (ej. "2026-05-15", como fecha de nacimiento, ingreso o salida):
///   se reconocen por formato "yyyy-MM-dd" y se preservan exactamente a las 00:00:00 UTC
///   evitando cualquier desfase o cambio de día por husos horarios locales.
/// - Instantes temporales (ej. "2026-05-15T14:30:00Z", como registros de auditoría o eventos con hora):
///   se normalizan con zona horaria a UTC.
/// - Serialización: siempre en formato ISO 8601 UTC explícito ("yyyy-MM-ddTHH:mm:ss.fffZ").
/// </summary>
public sealed class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    private static readonly string[] CalendarFormats = ["yyyy-MM-dd", "yyyy/MM/dd"];

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String)
            throw new JsonException("La fecha debe enviarse como cadena en formato ISO 8601.");

        var raw = reader.GetString();
        if (string.IsNullOrWhiteSpace(raw))
            throw new JsonException("La fecha no puede estar vacía.");

        var trimmed = raw.Trim();

        // 1. Detección y preservación de fechas calendario puras ("yyyy-MM-dd")
        if (trimmed.Length == 10 &&
            DateTime.TryParseExact(trimmed, CalendarFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var calendarDate))
        {
            return DateTime.SpecifyKind(new DateTime(calendarDate.Year, calendarDate.Month, calendarDate.Day, 0, 0, 0), DateTimeKind.Utc);
        }

        // 2. Parseo de instantes con hora y zona horaria a UTC
        if (DateTimeOffset.TryParse(trimmed, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto))
        {
            return DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Utc);
        }

        throw new JsonException($"Formato de fecha inválido: '{raw}'. Use ISO 8601 (por ejemplo, 2026-05-15 o 2026-05-15T14:30:00Z).");
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        var utc = value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
        writer.WriteStringValue(utc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
    }
}

public sealed class NullableUtcDateTimeJsonConverter : JsonConverter<DateTime?>
{
    private static readonly UtcDateTimeJsonConverter Inner = new();

    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return null;

        if (reader.TokenType == JsonTokenType.String && string.IsNullOrWhiteSpace(reader.GetString()))
            return null;

        return Inner.Read(ref reader, typeof(DateTime), options);
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (!value.HasValue)
        {
            writer.WriteNullValue();
            return;
        }

        Inner.Write(writer, value.Value, options);
    }
}
