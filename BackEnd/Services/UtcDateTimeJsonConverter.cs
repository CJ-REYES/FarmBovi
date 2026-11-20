using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FarmBovi.Api.Services;

/// <summary>
/// Política unificada de fechas de la API:
/// - Deserializa ISO 8601 (fechas calendario yyyy-MM-dd o timestamps con zona/UTC) normalizando a UTC.
/// - Serializa siempre en formato ISO 8601 UTC explícito ("yyyy-MM-ddTHH:mm:ss.fffZ" o "O" en UTC).
/// </summary>
public sealed class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String)
            throw new JsonException("La fecha debe enviarse como cadena en formato ISO 8601.");

        var raw = reader.GetString();
        if (string.IsNullOrWhiteSpace(raw))
            throw new JsonException("La fecha no puede estar vacía.");

        if (!DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto))
        {
            throw new JsonException($"Formato de fecha inválido: '{raw}'. Use ISO 8601 (por ejemplo, 2026-05-01 o 2026-05-01T14:30:00Z).");
        }

        return DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Utc);
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
