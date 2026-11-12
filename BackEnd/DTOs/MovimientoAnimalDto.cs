using System;
using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs
{
    public class MovimientoAnimalCreateDto
    {
        [Required] public string IdAnimal { get; set; }
        public string? IdLoteOrigen { get; set; }
        public string? IdLoteDestino { get; set; }
        [Required] public string Tipo { get; set; }
        [Required] public DateTime Fecha { get; set; }
        public string? OrigenExterno { get; set; }
        public string? DestinoExterno { get; set; }
        public string? Motivo { get; set; }
        [Required] public string IdAutor { get; set; }
    }
}