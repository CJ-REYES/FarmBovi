using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Reproduccion")]
public sealed class Reproduccion
{
    [Key]
    [Column(TypeName = "char(36)")]
    public Guid IdReproduccion { get; set; }

    [Column(TypeName = "char(36)")]
    public Guid IdAnimal { get; set; }

    [MaxLength(50)]
    public string TipoEvento { get; set; } = null!;

    public DateTime Fecha { get; set; }

    [MaxLength(250)]
    public string? Observaciones { get; set; }

    [Column(TypeName = "char(36)")]
    public Guid? IdAutor { get; set; }

    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;

    public DateTime? EliminadoEn { get; set; }

    public long VersionRegistro { get; set; } = 1;
}