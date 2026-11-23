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

    public int IdAutor { get; set; }
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

    public int IdAutor { get; set; }
    public DateTime? EliminadoEn { get; set; }
}

public sealed class TrasladoAnimalRanchoDto
{
    [Required]
    public Guid IdAnimal { get; set; }

    [Required]
    public Guid IdRanchoDestino { get; set; }

    public Guid? IdLoteDestino { get; set; }

    public DateTime? Fecha { get; set; }

    [MaxLength(500)]
    public string? Motivo { get; set; }
}

public sealed class TrasladoLoteRanchoDto
{
    [Required]
    public Guid IdLote { get; set; }

    [Required]
    public Guid IdRanchoDestino { get; set; }

    /// <summary>
    /// "MoverLoteCompleto" mueve el lote y todos sus animales activos al rancho destino.
    /// "ReubicarAnimalesEnLoteDestino" mueve solo los animales activos hacia un lote (o sin lote) del rancho destino.
    /// </summary>
    [MaxLength(40)]
    public string ModoLote { get; set; } = "MoverLoteCompleto";

    public Guid? IdLoteDestino { get; set; }

    public DateTime? Fecha { get; set; }

    [MaxLength(500)]
    public string? Motivo { get; set; }
}

public sealed record TrasladoRanchoResultDto(
    string Modo,
    Guid RanchoOrigenId,
    string RanchoOrigenNombre,
    Guid RanchoDestinoId,
    string RanchoDestinoNombre,
    int AnimalesTrasladados,
    Models.Lote? LoteTrasladado,
    IReadOnlyList<Models.Animal> Animales,
    IReadOnlyList<Models.MovimientoAnimal> Movimientos,
    string Mensaje);
