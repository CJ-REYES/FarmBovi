using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class MovimientoAnimalCreateDto
{
    public Guid? IdMovimiento { get; set; }

    [Required]
    public Guid IdAnimal { get; set; }

    public Guid? IdLoteOrigen { get; set; }
    public Guid? IdLoteDestino { get; set; }

    [Required, MaxLength(30)]
    public string Tipo { get; set; } = string.Empty;

    [Required]
    public DateTime Fecha { get; set; }

    [MaxLength(250)]
    public string? OrigenExterno { get; set; }

    [MaxLength(250)]
    public string? DestinoExterno { get; set; }

    public string? Motivo { get; set; }

    public Guid IdAutor { get; set; }
}

public sealed class MovimientoAnimalUpdateDto
{
    [Required]
    public Guid IdAnimal { get; set; }

    public Guid? IdLoteOrigen { get; set; }
    public Guid? IdLoteDestino { get; set; }

    [Required, MaxLength(30)]
    public string Tipo { get; set; } = string.Empty;

    [Required]
    public DateTime Fecha { get; set; }

    [MaxLength(250)]
    public string? OrigenExterno { get; set; }

    [MaxLength(250)]
    public string? DestinoExterno { get; set; }

    public string? Motivo { get; set; }

    public Guid IdAutor { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
