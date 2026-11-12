using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models
{
    [Table("Alimentacion")]
    public class Alimentacion
    {
        [Key]
        public string IdAlimentacion { get; set; } = Guid.NewGuid().ToString();

        [Required]
        public string IdAnimal { get; set; }

        public string? IdLote { get; set; }

        [Required]
        [MaxLength(150)]
        public string Alimento { get; set; }

        [Required]
        [MaxLength(150)]
        public string Racion { get; set; }

        [Required]
        [Column(TypeName = "decimal(10,3)")]
        public decimal Cantidad { get; set; }

        [Required]
        [MaxLength(20)]
        public string Unidad { get; set; }

        [Required]
        [MaxLength(80)]
        public string Frecuencia { get; set; }

        [Required]
        public DateTime Inicio { get; set; }

        public DateTime? Fin { get; set; }

        public string? CambioDieta { get; set; }

        [Required]
        public string IdAutor { get; set; }

        [Required]
        public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

        [Required]
        public long VersionRegistro { get; set; } = 1;

        public DateTime? EliminadoEn { get; set; }
    }
}