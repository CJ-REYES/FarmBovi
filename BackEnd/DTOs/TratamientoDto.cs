using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class TratamientoCreateDto
{
    public Guid? IdTratamiento { get; set; }

    [Required]
    public Guid IdEventoSanitario { get; set; }

    [Required, MaxLength(150)]
    public string Producto { get; set; } = string.Empty;

    [Required]
    public decimal Dosis { get; set; }

    [Required, MaxLength(30)]
    public string UnidadDosis { get; set; } = string.Empty;

    [MaxLength(80)]
    public string? ViaAdministracion { get; set; }

    [Required, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required]
    public DateTime FechaInicio { get; set; }

    public DateTime? FechaFin { get; set; }

    [Required, MaxLength(150)]
    public string Responsable { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? PrescripcionUri { get; set; }

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public Guid IdAutor { get; set; }
}

public sealed class TratamientoUpdateDto
{
    [Required]
    public Guid IdEventoSanitario { get; set; }

    [Required, MaxLength(150)]
    public string Producto { get; set; } = string.Empty;

    [Required]
    public decimal Dosis { get; set; }

    [Required, MaxLength(30)]
    public string UnidadDosis { get; set; } = string.Empty;

    [MaxLength(80)]
    public string? ViaAdministracion { get; set; }

    [Required, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required]
    public DateTime FechaInicio { get; set; }

    public DateTime? FechaFin { get; set; }

    [Required, MaxLength(150)]
    public string Responsable { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? PrescripcionUri { get; set; }

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;
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
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
}
