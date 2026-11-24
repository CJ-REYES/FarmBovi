using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class MovimientoAnimalCreateDto : IValidatableObject
{
    private static readonly HashSet<string> TiposPermitidos = new(StringComparer.OrdinalIgnoreCase)
    {
        "Alta", "CambioInterno", "Cambio interno", "Traslado", "Venta", "Baja"
    };

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdMovimiento { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLoteOrigen { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLoteDestino { get; set; }

    [Required, NotWhiteSpace, MaxLength(30)]
    public string Tipo { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Fecha { get; set; }

    [MaxLength(250)]
    public string? OrigenExterno { get; set; }

    [MaxLength(250)]
    public string? DestinoExterno { get; set; }

    [MaxLength(500)]
    public string? Motivo { get; set; }

    public int IdAutor { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!string.IsNullOrWhiteSpace(Tipo) && !TiposPermitidos.Contains(Tipo.Trim()))
        {
            yield return new ValidationResult(
                "El tipo de movimiento debe ser Alta, CambioInterno, Traslado, Venta o Baja.",
                [nameof(Tipo)]);
        }

        if (IdLoteOrigen.HasValue && IdLoteDestino.HasValue && IdLoteOrigen.Value == IdLoteDestino.Value)
        {
            yield return new ValidationResult(
                "El lote de origen y el lote de destino no pueden ser iguales.",
                [nameof(IdLoteOrigen), nameof(IdLoteDestino)]);
        }
    }
}

public sealed class MovimientoAnimalUpdateDto : IValidatableObject
{
    private static readonly HashSet<string> TiposPermitidos = new(StringComparer.OrdinalIgnoreCase)
    {
        "Alta", "CambioInterno", "Cambio interno", "Traslado", "Venta", "Baja"
    };

    [Required, NotEmptyGuid]
    public Guid IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLoteOrigen { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLoteDestino { get; set; }

    [Required, NotWhiteSpace, MaxLength(30)]
    public string Tipo { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Fecha { get; set; }

    [MaxLength(250)]
    public string? OrigenExterno { get; set; }

    [MaxLength(250)]
    public string? DestinoExterno { get; set; }

    [MaxLength(500)]
    public string? Motivo { get; set; }

    public int IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!string.IsNullOrWhiteSpace(Tipo) && !TiposPermitidos.Contains(Tipo.Trim()))
        {
            yield return new ValidationResult(
                "El tipo de movimiento debe ser Alta, CambioInterno, Traslado, Venta o Baja.",
                [nameof(Tipo)]);
        }

        if (IdLoteOrigen.HasValue && IdLoteDestino.HasValue && IdLoteOrigen.Value == IdLoteDestino.Value)
        {
            yield return new ValidationResult(
                "El lote de origen y el lote de destino no pueden ser iguales.",
                [nameof(IdLoteOrigen), nameof(IdLoteDestino)]);
        }
    }
}

public sealed class MovimientoAnimalResponseDto
{
    public Guid IdMovimiento { get; set; }
    public Guid IdAnimal { get; set; }
    public Guid? IdLoteOrigen { get; set; }
    public Guid? IdLoteDestino { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public DateTime Fecha { get; set; }
    public string? OrigenExterno { get; set; }
    public string? DestinoExterno { get; set; }
    public string? Motivo { get; set; }
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}

public sealed class TrasladoAnimalRanchoDto
{
    [Required, NotEmptyGuid]
    public Guid IdAnimal { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRanchoDestino { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLoteDestino { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? Fecha { get; set; }

    [MaxLength(500)]
    public string? Motivo { get; set; }
}

public sealed class TrasladoLoteRanchoDto : IValidatableObject
{
    private static readonly HashSet<string> ModosPermitidos = new(StringComparer.OrdinalIgnoreCase)
    {
        "MoverLoteCompleto",
        "ReubicarAnimalesEnLoteDestino"
    };

    [Required, NotEmptyGuid]
    public Guid IdLote { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRanchoDestino { get; set; }

    /// <summary>
    /// "MoverLoteCompleto" mueve el lote y todos sus animales activos al rancho destino.
    /// "ReubicarAnimalesEnLoteDestino" mueve solo los animales activos hacia un lote (o sin lote) del rancho destino.
    /// </summary>
    [MaxLength(40)]
    public string ModoLote { get; set; } = "MoverLoteCompleto";

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLoteDestino { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? Fecha { get; set; }

    [MaxLength(500)]
    public string? Motivo { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!string.IsNullOrWhiteSpace(ModoLote) && !ModosPermitidos.Contains(ModoLote.Trim()))
        {
            yield return new ValidationResult(
                "El modo de traslado debe ser 'MoverLoteCompleto' o 'ReubicarAnimalesEnLoteDestino'.",
                [nameof(ModoLote)]);
        }
    }
}

public sealed record TrasladoRanchoResultDto(
    string Modo,
    Guid RanchoOrigenId,
    string RanchoOrigenNombre,
    Guid RanchoDestinoId,
    string RanchoDestinoNombre,
    int AnimalesTrasladados,
    LoteResponseDto? LoteTrasladado,
    IReadOnlyList<AnimalResponseDto> Animales,
    IReadOnlyList<MovimientoAnimalResponseDto> Movimientos,
    string Mensaje);
