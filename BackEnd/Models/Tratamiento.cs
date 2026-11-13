<<<<<<< HEAD
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("Tratamientos")]
public sealed class Tratamiento
{
    [Key]
    public int IdTratamiento { get; set; }
    public int IdAnimal { get; set; }
    public string Tipo { get; set; } = null!;
    public string Medicamento { get; set; } = null!;
    public string? Dosis { get; set; }
    public DateTime Fecha { get; set; }
    public string? Observaciones { get; set; }
    public int? IdAutor { get; set; }
    public DateTime FechaCreacion { get; set; } = DateTime.UtcNow;
    public DateTime? EliminadoEn { get; set; }
}
=======
namespace FarmBovi.Api.Models;

public sealed class Tratamiento
{
    public int IdTratamiento { get; set; }
    public int IdEventoSanitario { get; set; }
    public string Producto { get; set; } = string.Empty;
    public decimal Dosis { get; set; }
    public string UnidadDosis { get; set; } = string.Empty;
    public string? ViaAdministracion { get; set; }
    public string Frecuencia { get; set; } = string.Empty;
    public DateTime FechaInicio { get; set; }
    public DateTime? FechaFin { get; set; }
    public string Responsable { get; set; } = string.Empty;
    public string? PrescripcionUri { get; set; }
    public string Estado { get; set; } = string.Empty;
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676
