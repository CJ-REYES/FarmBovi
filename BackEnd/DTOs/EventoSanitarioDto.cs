using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class EventoSanitarioCreateDto
{
    public Guid? IdEventoSanitario { get; set; }

    [Required]
    public Guid IdAnimal { get; set; }

    [Required, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required]
    public DateTime Fecha { get; set; }

    public string? Sintomas { get; set; }
    public string? Diagnostico { get; set; }

    [MaxLength(150)]
    public string? ProfesionalDiagnostico { get; set; }

    [MaxLength(500)]
    public string? EvidenciaDiagnosticoUri { get; set; }

    [Required, MaxLength(150)]
    public string Responsable { get; set; } = string.Empty;

    public string? Observaciones { get; set; }
    public Guid IdAutor { get; set; }
}

public sealed class EventoSanitarioUpdateDto
{
    [Required]
    public Guid IdAnimal { get; set; }

    [Required, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required]
    public DateTime Fecha { get; set; }

    public string? Sintomas { get; set; }
    public string? Diagnostico { get; set; }

    [MaxLength(150)]
    public string? ProfesionalDiagnostico { get; set; }

    [MaxLength(500)]
    public string? EvidenciaDiagnosticoUri { get; set; }

    [Required, MaxLength(150)]
    public string Responsable { get; set; } = string.Empty;

    public string? Observaciones { get; set; }
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
}
