using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class RecordatorioCreateDto : IValidatableObject
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdRecordatorio { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdTratamiento { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdResponsable { get; set; }

    [Required, NotWhiteSpace, MaxLength(35)]
    public string Tipo { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(250)]
    public string Descripcion { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime FechaProgramada { get; set; }

    [Required, NotWhiteSpace, MaxLength(25)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaCompletado { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (IdAnimal.HasValue && IdLote.HasValue)
        {
            yield return new ValidationResult(
                "El recordatorio puede ser general del rancho, individual o por lote; idAnimal e idLote son excluyentes.",
                [nameof(IdAnimal), nameof(IdLote)]);
        }

        if (IdTratamiento.HasValue && IdLote.HasValue)
        {
            yield return new ValidationResult(
                "Un recordatorio vinculado a un tratamiento individual no puede asignarse a un lote.",
                [nameof(IdTratamiento), nameof(IdLote)]);
        }
    }
}

public sealed class RecordatorioUpdateDto : IValidatableObject
{
    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdTratamiento { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdResponsable { get; set; }

    [Required, NotWhiteSpace, MaxLength(35)]
    public string Tipo { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(250)]
    public string Descripcion { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime FechaProgramada { get; set; }

    [Required, NotWhiteSpace, MaxLength(25)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaCompletado { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (IdAnimal.HasValue && IdLote.HasValue)
        {
            yield return new ValidationResult(
                "El recordatorio puede ser general del rancho, individual o por lote; idAnimal e idLote son excluyentes.",
                [nameof(IdAnimal), nameof(IdLote)]);
        }

        if (IdTratamiento.HasValue && IdLote.HasValue)
        {
            yield return new ValidationResult(
                "Un recordatorio vinculado a un tratamiento individual no puede asignarse a un lote.",
                [nameof(IdTratamiento), nameof(IdLote)]);
        }
    }
}

public sealed class RecordatorioResponseDto
{
    public Guid IdRecordatorio { get; set; }
    public Guid IdRancho { get; set; }
    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }
    public Guid? IdTratamiento { get; set; }
    public Guid? IdResponsable { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public string Descripcion { get; set; } = string.Empty;
    public DateTime FechaProgramada { get; set; }
    public string Estado { get; set; } = string.Empty;
    public DateTime? FechaCompletado { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
