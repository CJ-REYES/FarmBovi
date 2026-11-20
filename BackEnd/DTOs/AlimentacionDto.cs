using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class AlimentacionCreateDto
{
    public Guid? IdAlimentacion { get; set; }
    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }

    [Required, MaxLength(150)]
    public string Alimento { get; set; } = string.Empty;

    [Required, MaxLength(150)]
    public string Racion { get; set; } = string.Empty;

    [Required]
    public decimal Cantidad { get; set; }

    [Required, MaxLength(20)]
    public string Unidad { get; set; } = string.Empty;

    [Required, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required]
    public DateTime Inicio { get; set; }

    public DateTime? Fin { get; set; }
    public string? CambioDieta { get; set; }

    public Guid IdAutor { get; set; }
}

public sealed class AlimentacionUpdateDto
{
    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }

    [Required, MaxLength(150)]
    public string Alimento { get; set; } = string.Empty;

    [Required, MaxLength(150)]
    public string Racion { get; set; } = string.Empty;

    [Required]
    public decimal Cantidad { get; set; }

    [Required, MaxLength(20)]
    public string Unidad { get; set; } = string.Empty;

    [Required, MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required]
    public DateTime Inicio { get; set; }

    public DateTime? Fin { get; set; }
    public string? CambioDieta { get; set; }

    public Guid IdAutor { get; set; }
    public DateTime? EliminadoEn { get; set; }
}