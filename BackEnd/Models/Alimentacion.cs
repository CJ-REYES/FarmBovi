using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Alimentacion")]
public sealed class Alimentacion
{
    [Key]
    public Guid IdAlimentacion { get; set; } = Guid.NewGuid();

    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }

    [Required]
    [MaxLength(150)]
    public string Alimento { get; set; } = string.Empty;

    [Required]
    [MaxLength(150)]
    public string Racion { get; set; } = string.Empty;

    [Required]
    [Column(TypeName = "decimal(10,3)")]
    public decimal Cantidad { get; set; }

    [Required]
    [MaxLength(20)]
    public string Unidad { get; set; } = string.Empty;

    [Required]
    [MaxLength(80)]
    public string Frecuencia { get; set; } = string.Empty;

    [Required]
    public DateTime Inicio { get; set; }

    public DateTime? Fin { get; set; }
    public string? CambioDieta { get; set; }

    [Required]
    public int IdAutor { get; set; }

    [Required]
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    [Required]
    public long VersionRegistro { get; set; } = 1;

    public DateTime? EliminadoEn { get; set; }
}
