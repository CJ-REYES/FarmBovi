using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("MovimientoAnimal")]
public sealed class MovimientoAnimal
{
    [Key]
    public Guid IdMovimiento { get; set; } = Guid.NewGuid();

    [Required]
    public Guid IdAnimal { get; set; }

    public Guid? IdLoteOrigen { get; set; }
    public Guid? IdLoteDestino { get; set; }

    [Required]
    [MaxLength(30)]
    public string Tipo { get; set; } = string.Empty;

    [Required]
    public DateTime Fecha { get; set; }

    [MaxLength(250)]
    public string? OrigenExterno { get; set; }

    [MaxLength(250)]
    public string? DestinoExterno { get; set; }

    public string? Motivo { get; set; }

    [Required]
    public Guid IdAutor { get; set; }

    [Required]
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    [Required]
    public long VersionRegistro { get; set; } = 1;

    public DateTime? EliminadoEn { get; set; }
}