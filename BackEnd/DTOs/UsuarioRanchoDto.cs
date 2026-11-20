using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class UsuarioRanchoCreateDto : IValidatableObject
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdUsuarioRancho { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdUsuario { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Rol { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaAlta { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaBaja { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (FechaAlta.HasValue && FechaBaja.HasValue && FechaBaja.Value < FechaAlta.Value)
        {
            yield return new ValidationResult(
                "La fecha de baja no puede ser anterior a la fecha de alta.",
                [nameof(FechaBaja), nameof(FechaAlta)]);
        }
    }
}

public sealed class UsuarioRanchoUpdateDto : IValidatableObject
{
    [Required, NotEmptyGuid]
    public Guid IdUsuario { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Rol { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaAlta { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaBaja { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (FechaAlta.HasValue && FechaBaja.HasValue && FechaBaja.Value < FechaAlta.Value)
        {
            yield return new ValidationResult(
                "La fecha de baja no puede ser anterior a la fecha de alta.",
                [nameof(FechaBaja), nameof(FechaAlta)]);
        }
    }
}

public sealed class UsuarioRanchoResponseDto
{
    public Guid IdUsuarioRancho { get; set; }
    public Guid IdUsuario { get; set; }
    public Guid IdRancho { get; set; }
    public string Rol { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public DateTime FechaAlta { get; set; }
    public DateTime? FechaBaja { get; set; }
}
