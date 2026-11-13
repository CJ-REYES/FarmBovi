using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Reproduccion")]
public sealed class Reproduccion
{
    [Key]
    public int IdReproduccion { get; set; }
    public int IdAnimal { get; set; }
    public string TipoEvento { get; set; } = null!;
    public DateTime Fecha { get; set; }
    public string? Observaciones { get; set; }
    public int? IdAutor { get; set; }
    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;
    public DateTime? EliminadoEn { get; set; }
}