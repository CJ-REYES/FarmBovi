using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class AnimalCreateDto
{
    public Guid? IdAnimal { get; set; }

    [Required]
    public Guid IdRancho { get; set; }

    public Guid? IdLote { get; set; }

    [Required, MaxLength(80)]
    public string Arete { get; set; } = string.Empty;

    [Required, MaxLength(80)]
    public string Raza { get; set; } = string.Empty;

    [Required, MaxLength(20)]
    public string Sexo { get; set; } = string.Empty;

    public DateTime? FechaNacimiento { get; set; }

    [Required]
    public DateTime FechaIngreso { get; set; }

    [Required, MaxLength(120)]
    public string Procedencia { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public DateTime? FechaSalida { get; set; }
    public string? Observaciones { get; set; }
    public Guid IdAutor { get; set; }
}

public sealed class AnimalUpdateDto
{
    [Required]
    public Guid IdRancho { get; set; }

    public Guid? IdLote { get; set; }

    [Required, MaxLength(80)]
    public string Arete { get; set; } = string.Empty;

    [Required, MaxLength(80)]
    public string Raza { get; set; } = string.Empty;

    [Required, MaxLength(20)]
    public string Sexo { get; set; } = string.Empty;

    public DateTime? FechaNacimiento { get; set; }

    [Required]
    public DateTime FechaIngreso { get; set; }

    [Required, MaxLength(120)]
    public string Procedencia { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public DateTime? FechaSalida { get; set; }
    public string? Observaciones { get; set; }
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
}
