using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Pesaje")]
public sealed class Pesaje
{
    [Key]
    [Column(TypeName = "char(36)]")]
    public Guid IdPesaje { get; set; }

    [Column(TypeName = "char(36)")]
    public Guid IdAnimal { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal Peso { get; set; }

    public DateTime Fecha { get; set; }

    [MaxLength(250)]
    public string? Observaciones { get; set; }

    [Column(TypeName = "char(36)")]
    public Guid? IdAutor { get; set; }

    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;

    public DateTime? EliminadoEn { get; set; }

    public long VersionRegistro { get; set; } = 1;
}