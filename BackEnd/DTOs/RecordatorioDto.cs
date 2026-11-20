using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class RecordatorioCreateDto
{
    public Guid? IdRecordatorio { get; set; }

    [Required]
    public Guid IdRancho { get; set; }

    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }
    public Guid? IdTratamiento { get; set; }
    public Guid? IdResponsable { get; set; }

    [Required, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required, MaxLength(500)]
    public string Descripcion { get; set; } = string.Empty;

    [Required]
    public DateTime FechaProgramada { get; set; }

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public DateTime? FechaCompletado { get; set; }
    public Guid IdAutor { get; set; }
}

public sealed class RecordatorioUpdateDto
{
    [Required]
    public Guid IdRancho { get; set; }

    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }
    public Guid? IdTratamiento { get; set; }
    public Guid? IdResponsable { get; set; }

    [Required, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required, MaxLength(500)]
    public string Descripcion { get; set; } = string.Empty;

    [Required]
    public DateTime FechaProgramada { get; set; }

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public DateTime? FechaCompletado { get; set; }
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
}
