using System;
using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs
{
    public class AlimentacionCreateDto
    {
        [Required] public string IdAnimal { get; set; } = string.Empty;
        public string? IdLote { get; set; }
        [Required] public string Alimento { get; set; } = string.Empty;
        [Required] public string Racion { get; set; } = string.Empty;
        [Required] public decimal Cantidad { get; set; }
        [Required] public string Unidad { get; set; } = string.Empty;
        [Required] public string Frecuencia { get; set; } = string.Empty;
        [Required] public DateTime Inicio { get; set; }
        public DateTime? Fin { get; set; }
        public string? CambioDieta { get; set; }
        [Required] public string IdAutor { get; set; } = string.Empty;
    }
}