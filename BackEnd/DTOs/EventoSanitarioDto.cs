using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class EventoSanitarioCreateDto
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdEventoSanitario { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdAnimal { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Fecha { get; set; }

    [MaxLength(1000)]
    public string? Sintomas { get; set; }

    [MaxLength(1000)]
    public string? Diagnostico { get; set; }

    [MaxLength(150)]
    public string? ProfesionalDiagnostico { get; set; }

    [MaxLength(500)]
    public string? EvidenciaDiagnosticoUri { get; set; }

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Responsable { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? Observaciones { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }
}

public sealed class EventoSanitarioUpdateDto
{
    [Required, NotEmptyGuid]
    public Guid IdAnimal { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Fecha { get; set; }

    [MaxLength(1000)]
    public string? Sintomas { get; set; }

    [MaxLength(1000)]
    public string? Diagnostico { get; set; }

    [MaxLength(150)]
    public string? ProfesionalDiagnostico { get; set; }

    [MaxLength(500)]
    public string? EvidenciaDiagnosticoUri { get; set; }

    [Required, NotWhiteSpace, MaxLength(150)]
    public string Responsable { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? Observaciones { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }
}

public sealed class EventoSanitarioResponseDto
{
    public Guid IdEventoSanitario { get; set; }
    public Guid IdAnimal { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public DateTime Fecha { get; set; }
    public string? Sintomas { get; set; }
    public string? Diagnostico { get; set; }
    public string? ProfesionalDiagnostico { get; set; }
    public string? EvidenciaDiagnosticoUri { get; set; }
    public string Responsable { get; set; } = string.Empty;
    public string? Observaciones { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
