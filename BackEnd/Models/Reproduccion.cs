using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Reproduccion")]
public sealed class Reproduccion
{
    [Key]
    [Column(TypeName = "char(36)")]
    public Guid IdReproduccion { get; set; } = Guid.NewGuid();

    [Column(TypeName = "char(36)")]
    public Guid IdAnimal { get; set; }

    [Required]
    [MaxLength(50)]
    public string TipoEvento { get; set; } = string.Empty;

    public DateTime Fecha { get; set; } = DateTime.UtcNow;

    [MaxLength(250)]
    public string? Observaciones { get; set; }

    // Cambiado de Guid a int para que coincida con el usuario autenticado
    public int IdAutor { get; set; }

    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;

    public DateTime? EliminadoEn { get; set; }

    public long VersionRegistro { get; set; } = 1;
}