using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("EventosSanitarios")]
public sealed class EventoSanitario
{
    [Key]
    public Guid IdEventoSanitario { get; set; } = Guid.NewGuid();

    [Required]
    public Guid IdAnimal { get; set; }

    [Required, MaxLength(100)]
    public string Tipo { get; set; } = string.Empty;

    [Required]
    public DateTime Fecha { get; set; }

    public string? Sintomas { get; set; }
    public string? Diagnostico { get; set; }

    [MaxLength(150)]
    public string? ProfesionalDiagnostico { get; set; }

    [MaxLength(500)]
    public string? EvidenciaDiagnosticoUri { get; set; }

    [Required, MaxLength(150)]
    public string Responsable { get; set; } = string.Empty;

    public string? Observaciones { get; set; }

    [Required]
    public int IdAutor { get; set; }

    [Required]
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    [Required]
    public long VersionRegistro { get; set; } = 1;

    public DateTime? EliminadoEn { get; set; }
}