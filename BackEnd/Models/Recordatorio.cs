using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Recordatorios")]
public sealed class Recordatorio
{
    [Key]
    public Guid IdRecordatorio { get; set; } = Guid.NewGuid();

    [Required]
    public Guid IdRancho { get; set; }

    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }
    public Guid? IdTratamiento { get; set; }
    public Guid? IdResponsable { get; set; }

    [Required, MaxLength(50)]
    public string Tipo { get; set; } = string.Empty;

    [Required, MaxLength(500)]
    public string Descripcion { get; set; } = string.Empty;

    [Required]
    public DateTime FechaProgramada { get; set; }

    [Required, MaxLength(30)]
    public string Estado { get; set; } = string.Empty;

    public DateTime? FechaCompletado { get; set; }

    [Required]
    public Guid IdAutor { get; set; }

    [Required]
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    [Required]
    public long VersionRegistro { get; set; } = 1;

    public DateTime? EliminadoEn { get; set; }
}