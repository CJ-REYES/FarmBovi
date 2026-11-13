using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class CattleRequest : IValidatableObject
{
    [Required(ErrorMessage = "El arete es obligatorio.")]
    [RegularExpression(@"^[A-Za-z0-9][A-Za-z0-9-]{0,39}$", ErrorMessage = "El arete debe tener de 1 a 40 letras, números o guiones, y comenzar con una letra o número.")]
    public string EarTag { get; init; } = string.Empty;

    [StringLength(80, ErrorMessage = "El nombre admite hasta 80 caracteres.")]
    public string Name { get; init; } = string.Empty;

    [Required(ErrorMessage = "La raza es obligatoria.")]
    [StringLength(80, ErrorMessage = "La raza admite hasta 80 caracteres.")]
    public string Breed { get; init; } = string.Empty;

    [Required(ErrorMessage = "El sexo es obligatorio.")]
    [RegularExpression("^(Hembra|Macho)$", ErrorMessage = "El sexo debe ser Hembra o Macho.")]
    public string Sex { get; init; } = "Hembra";

    public DateOnly? BirthDate { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (BirthDate > DateOnly.FromDateTime(DateTime.UtcNow))
        {
            yield return new ValidationResult("La fecha de nacimiento no puede ser futura.", [nameof(BirthDate)]);
        }
    }
}
