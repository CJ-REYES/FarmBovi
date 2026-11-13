using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models
{
    [Table("MovimientoAnimal")]
    public class MovimientoAnimal
    {
        [Key]
        public string IdMovimiento { get; set; } = Guid.NewGuid().ToString();

        [Required]
        public string IdAnimal { get; set; } = string.Empty;

        public string? IdLoteOrigen { get; set; }

        public string? IdLoteDestino { get; set; }

        [Required]
        [MaxLength(30)]
        public string Tipo { get; set; } = string.Empty;

        [Required]
        public DateTime Fecha { get; set; }

        [MaxLength(250)]
        public string? OrigenExterno { get; set; }

        [MaxLength(250)]
        public string? DestinoExterno { get; set; }

        public string? Motivo { get; set; }

        [Required]
        public string IdAutor { get; set; } = string.Empty;

        [Required]
        public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

        [Required]
        public long VersionRegistro { get; set; } = 1;

        public DateTime? EliminadoEn { get; set; }
    }
}