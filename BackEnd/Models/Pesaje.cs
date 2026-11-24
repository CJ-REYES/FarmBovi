using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

/// <summary>
/// Registro de pesaje de báscula oficial o estimado mediante BoviScale IA asociado a un bovino.
/// Alineado a la Regla 14 (<see cref="Services.FarmDomainValidationService.ValidatePesaje"/>).
/// </summary>
[Table("Pesaje")]
public sealed class Pesaje
{
    [Key]
    public Guid IdPesaje { get; set; } = Guid.NewGuid();

    [Required]
    public Guid IdAnimal { get; set; }

    [Required]
    public decimal PesoRealKg { get; set; }

    [Required]
    public DateTime Fecha { get; set; }

    [Required]
    [MaxLength(150)]
    public string FuenteBascula { get; set; } = "Báscula registrada en campo";

    [Required]
    [MaxLength(180)]
    public string Responsable { get; set; } = "Operador de campo";

    [MaxLength(500)]
    public string? Observaciones { get; set; }

    [Required]
    [MaxLength(30)]
    public string OrigenPesaje { get; set; } = "manual";

    /// <summary>
    /// Identificador único de solicitud para garantizar idempotencia en integraciones (ej. BoviScale IA).
    /// Nulo para pesajes manuales tradicionales.
    /// </summary>
    public Guid? IdSolicitud { get; set; }

    /// <summary>
    /// Referencia opcional a la fotografía (<see cref="ArchivoMultimedia"/>) utilizada para estimar el peso.
    /// </summary>
    public Guid? IdArchivoMultimedia { get; set; }

    /// <summary>
    /// Confianza reportada por el modelo de estimación (escala 0.0000 a 1.0000), cuando aplica.
    /// </summary>
    public decimal? ConfianzaModelo { get; set; }

    /// <summary>
    /// Versión del modelo de IA externo que produjo la estimación, cuando aplica.
    /// </summary>
    [MaxLength(80)]
    public string? VersionModelo { get; set; }

    [Required]
    public int IdAutor { get; set; }

    [Required]
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    [Required]
    public long VersionRegistro { get; set; } = 1;

    public DateTime? EliminadoEn { get; set; }
}
