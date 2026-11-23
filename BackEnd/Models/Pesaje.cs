using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

/// <summary>
/// Registro de pesaje de báscula oficial (o estimado confirmado) asociado a un bovino.
/// Alineado a la Regla 14 (<see cref="Services.FarmDomainValidationService.ValidatePesaje"/>).
/// </summary>
[Table("Pesaje")]
public sealed class Pesaje
{
    [Key]
    [Column(TypeName = "char(36)")]
    public Guid IdPesaje { get; set; } = Guid.NewGuid();

    [Required]
    [Column(TypeName = "char(36)")]
    public Guid IdAnimal { get; set; }

    [Required]
    [Column(TypeName = "decimal(10,2)")]
    public decimal PesoRealKg { get; set; }

    [Required]
    public DateTime Fecha { get; set; } = DateTime.UtcNow;

    [Required]
    [MaxLength(150)]
    public string FuenteBascula { get; set; } = "Báscula registrada en campo";

    [Required]
    [MaxLength(180)]
    public string Responsable { get; set; } = "Operador de campo";

    [MaxLength(500)]
    public string? Observaciones { get; set; }

    [Required]
    [MaxLength(30)]
    public string OrigenPesaje { get; set; } = "manual";

    // Cambiado de Guid a int para que coincida con el usuario autenticado
    [Required]
    public int IdAutor { get; set; }

    [Required]
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    [Required]
    public long VersionRegistro { get; set; } = 1;

    public DateTime? EliminadoEn { get; set; }
}
