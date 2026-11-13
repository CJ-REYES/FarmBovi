using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Pesajes")]
public sealed class Pesaje
{
    [Key]
    public int IdPesaje { get; set; }
    public int IdAnimal { get; set; }
    public decimal Peso { get; set; }
    public DateTime Fecha { get; set; }
    public string? Observaciones { get; set; }
    public int? IdAutor { get; set; }
    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;
    public DateTime? EliminadoEn { get; set; }
}