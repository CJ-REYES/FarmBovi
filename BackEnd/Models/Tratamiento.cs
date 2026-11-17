using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Tratamientos")]
public sealed class Tratamiento
{
    [Key]
    public Guid IdTratamiento { get; set; } = Guid.NewGuid();

    [Required]
    public Guid IdEventoSanitario { get; set; }

    [Required]
    public Guid IdAnimal { get; set; }

    [Required, MaxLength(100)]
    public string Tipo { get; set; } = string.Empty;

    [Required, MaxLength(150)]
    public string Medicamento { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? Dosis { get; set; }

    [Required]
    public DateTime Fecha { get; set; }

    public string? Observaciones { get; set; }

    [Required]
    public Guid IdAutor { get; set; }

    [Required]
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    [Required]
    public long VersionRegistro { get; set; } = 1;

    public DateTime? EliminadoEn { get; set; }
}