using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Controllers;

namespace FarmBovi.Api.DTOs;

public sealed class TratamientoCreateDto : IValidatableObject
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdTratamiento { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdEventoSanitario { get; set; }

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Producto { get; set; } = string.Empty;

    [Required, PositiveDecimal]
    public decimal Dosis { get; set; }

    [Required, NotWhiteSpace, MaxLength(20)]
    public string UnidadDosis { get; set; } = string.Empty;

    [MaxLength(60)]
    public string? ViaAdministracion { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime FechaInicio { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaFin { get; set; }

    [Required, NotWhiteSpace, MaxLength(180)]
    public string Responsable { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? PrescripcionUri { get; set; }

    [Required, NotWhiteSpace, MaxLength(25)]
    public string Estado { get; set; } = string.Empty;

    [NotEmptyGuid(AllowNull = true)]
    public int? IdAutor { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (FechaFin.HasValue && ApiProblemResults.EnsureUtc(FechaFin.Value) < ApiProblemResults.EnsureUtc(FechaInicio))
        {
            yield return new ValidationResult(
                "La fecha de fin del tratamiento no puede ser anterior a la fecha de inicio.",
                [nameof(FechaFin), nameof(FechaInicio)]);
        }
    }
}

public sealed class TratamientoUpdateDto : IValidatableObject
{
    [Required, NotEmptyGuid]
    public Guid IdEventoSanitario { get; set; }

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Producto { get; set; } = string.Empty;

    [Required, PositiveDecimal]
    public decimal Dosis { get; set; }

    [Required, NotWhiteSpace, MaxLength(20)]
    public string UnidadDosis { get; set; } = string.Empty;

    [MaxLength(60)]
    public string? ViaAdministracion { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime FechaInicio { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaFin { get; set; }

    [Required, NotWhiteSpace, MaxLength(180)]
    public string Responsable { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? PrescripcionUri { get; set; }

    [Required, NotWhiteSpace, MaxLength(25)]
    public string Estado { get; set; } = string.Empty;

    [NotEmptyGuid(AllowNull = true)]
    public int? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (FechaFin.HasValue && ApiProblemResults.EnsureUtc(FechaFin.Value) < ApiProblemResults.EnsureUtc(FechaInicio))
        {
            yield return new ValidationResult(
                "La fecha de fin del tratamiento no puede ser anterior a la fecha de inicio.",
                [nameof(FechaFin), nameof(FechaInicio)]);
        }
    }
}

public sealed class TratamientoResponseDto
{
    public Guid IdTratamiento { get; set; }
    public Guid IdEventoSanitario { get; set; }
    public string Producto { get; set; } = string.Empty;
    public decimal Dosis { get; set; }
    public string UnidadDosis { get; set; } = string.Empty;
    public string? ViaAdministracion { get; set; }
    public string Frecuencia { get; set; } = string.Empty;
    public DateTime FechaInicio { get; set; }
    public DateTime? FechaFin { get; set; }
    public string Responsable { get; set; } = string.Empty;
    public string? PrescripcionUri { get; set; }
    public string Estado { get; set; } = string.Empty;
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
