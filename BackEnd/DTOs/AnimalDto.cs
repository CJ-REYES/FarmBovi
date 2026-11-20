using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class AnimalCreateDto : IValidatableObject
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAnimal { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Arete { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Raza { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Sexo { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaNacimiento { get; set; }

    [Required, ValidDateRange]
    public DateTime FechaIngreso { get; set; }

    [Required, NotWhiteSpace, MaxLength(120)]
    public string Procedencia { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaSalida { get; set; }

    [MaxLength(1000)]
    public string? Observaciones { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (FechaNacimiento.HasValue && FechaNacimiento.Value > FechaIngreso)
        {
            yield return new ValidationResult(
                "La fecha de nacimiento no puede ser posterior a la fecha de ingreso.",
                [nameof(FechaNacimiento), nameof(FechaIngreso)]);
        }

        if (FechaSalida.HasValue && FechaSalida.Value < FechaIngreso)
        {
            yield return new ValidationResult(
                "La fecha de salida no puede ser anterior a la fecha de ingreso.",
                [nameof(FechaSalida), nameof(FechaIngreso)]);
        }
    }
}

public sealed class AnimalUpdateDto : IValidatableObject
{
    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Arete { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Raza { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Sexo { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaNacimiento { get; set; }

    [Required, ValidDateRange]
    public DateTime FechaIngreso { get; set; }

    [Required, NotWhiteSpace, MaxLength(120)]
    public string Procedencia { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaSalida { get; set; }

    [MaxLength(1000)]
    public string? Observaciones { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (FechaNacimiento.HasValue && FechaNacimiento.Value > FechaIngreso)
        {
            yield return new ValidationResult(
                "La fecha de nacimiento no puede ser posterior a la fecha de ingreso.",
                [nameof(FechaNacimiento), nameof(FechaIngreso)]);
        }

        if (FechaSalida.HasValue && FechaSalida.Value < FechaIngreso)
        {
            yield return new ValidationResult(
                "La fecha de salida no puede ser anterior a la fecha de ingreso.",
                [nameof(FechaSalida), nameof(FechaIngreso)]);
        }
    }
}

public sealed class AnimalResponseDto
{
    public Guid IdAnimal { get; set; }
    public Guid IdRancho { get; set; }
    public Guid? IdLote { get; set; }
    public string Arete { get; set; } = string.Empty;
    public string Raza { get; set; } = string.Empty;
    public string Sexo { get; set; } = string.Empty;
    public DateTime? FechaNacimiento { get; set; }
    public DateTime FechaIngreso { get; set; }
    public string Procedencia { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public DateTime? FechaSalida { get; set; }
    public string? Observaciones { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
