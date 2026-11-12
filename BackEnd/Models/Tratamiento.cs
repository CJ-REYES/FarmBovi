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
