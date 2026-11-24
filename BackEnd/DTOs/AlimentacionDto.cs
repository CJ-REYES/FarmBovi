using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Controllers;

namespace FarmBovi.Api.DTOs;

public sealed class AlimentacionCreateDto : IValidatableObject
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAlimentacion { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Alimento { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Racion { get; set; } = string.Empty;

    [Required, PositiveDecimal]
    public decimal Cantidad { get; set; }

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Unidad { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Inicio { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? Fin { get; set; }

    [MaxLength(500)]
    public string? CambioDieta { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (IdAnimal.HasValue == IdLote.HasValue)
        {
            yield return new ValidationResult(
                "Debe informarse exactamente uno entre idAnimal e idLote (son mutuamente excluyentes).",
                [nameof(IdAnimal), nameof(IdLote)]);
        }

        if (Fin.HasValue && ApiProblemResults.EnsureUtc(Fin.Value) < ApiProblemResults.EnsureUtc(Inicio))
        {
            yield return new ValidationResult(
                "La fecha de fin no puede ser anterior a la fecha de inicio.",
                [nameof(Fin), nameof(Inicio)]);
        }
    }
}

public sealed class AlimentacionUpdateDto : IValidatableObject
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Alimento { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Racion { get; set; } = string.Empty;

    [Required, PositiveDecimal]
    public decimal Cantidad { get; set; }

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Unidad { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Inicio { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? Fin { get; set; }

    [MaxLength(500)]
    public string? CambioDieta { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (IdAnimal.HasValue == IdLote.HasValue)
        {
            yield return new ValidationResult(
                "Debe informarse exactamente uno entre idAnimal e idLote (son mutuamente excluyentes).",
                [nameof(IdAnimal), nameof(IdLote)]);
        }

        if (Fin.HasValue && ApiProblemResults.EnsureUtc(Fin.Value) < ApiProblemResults.EnsureUtc(Inicio))
        {
            yield return new ValidationResult(
                "La fecha de fin no puede ser anterior a la fecha de inicio.",
                [nameof(Fin), nameof(Inicio)]);
        }
    }
}

public sealed class AlimentacionResponseDto
{
    public Guid IdAlimentacion { get; set; }
    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }
    public string Alimento { get; set; } = string.Empty;
    public string Racion { get; set; } = string.Empty;
    public decimal Cantidad { get; set; }
    public string Unidad { get; set; } = string.Empty;
    public string Frecuencia { get; set; } = string.Empty;
    public DateTime Inicio { get; set; }
    public DateTime? Fin { get; set; }
    public string? CambioDieta { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
