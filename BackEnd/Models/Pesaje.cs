using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Pesaje")]
public sealed class Pesaje
{
    [Key]
    [Column(TypeName = "char(36)")]
    public Guid IdPesaje { get; set; } = Guid.NewGuid();

    [Column(TypeName = "char(36)")]
    public Guid IdAnimal { get; set; }

    [Column(TypeName = "decimal(10,2)")]
    public decimal Peso { get; set; }

    public DateTime Fecha { get; set; } = DateTime.UtcNow;

    [MaxLength(250)]
    public string? Observaciones { get; set; }

    // Cambiado de Guid a int para que coincida con el usuario autenticado
    public int IdAutor { get; set; }

    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;

    public DateTime? EliminadoEn { get; set; }

    public long VersionRegistro { get; set; } = 1;
}