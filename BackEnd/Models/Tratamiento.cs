using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Tratamientos")]
public sealed class Tratamiento
{
    [Key]
    public int IdTratamiento { get; set; }
    public int IdAnimal { get; set; }
    public string Tipo { get; set; } = null!;
    public string Medicamento { get; set; } = null!;
    public string? Dosis { get; set; }
    public DateTime Fecha { get; set; }
    public string? Observaciones { get; set; }
    public int? IdAutor { get; set; }
    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;
    public DateTime? EliminadoEn { get; set; }
}