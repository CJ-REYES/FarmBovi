using System;
using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs
{
    public class AlimentacionCreateDto
    {
        [Required] public string IdAnimal { get; set; }
        public string? IdLote { get; set; }
        [Required] public string Alimento { get; set; }
        [Required] public string Racion { get; set; }
        [Required] public decimal Cantidad { get; set; }
        [Required] public string Unidad { get; set; }
        [Required] public string Frecuencia { get; set; }
        [Required] public DateTime Inicio { get; set; }
        public DateTime? Fin { get; set; }
        public string? CambioDieta { get; set; }
        [Required] public string IdAutor { get; set; }
    }
}