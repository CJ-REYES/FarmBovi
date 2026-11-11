namespace FarmBovi.Api.Models;

public sealed class Tratamiento
{
    public string IdTratamiento { get; set; } = Guid.NewGuid().ToString();
    public string IdEventoSanitario { get; set; } = string.Empty;
    public string Producto { get; set; } = string.Empty;
    public decimal Dosis { get; set; }
    public string UnidadDosis { get; set; } = string.Empty;
    public string? ViaAdministracion { get; set; }
    public string Frecuencia { get; set; } = string.Empty;
    public DateTime FechaInicio { get; set; } = DateTime.UtcNow;
    public DateTime? FechaFin { get; set; }
    public string Responsable { get; set; } = string.Empty;
    public string? PrescripcionUri { get; set; }
    public string Estado { get; set; } = "En curso";
    public string IdAutor { get; set; } = "00000000-0000-0000-0000-000000000001";
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }

    public EventoSanitario? EventoSanitario { get; set; }
    public ICollection<Recordatorio> Recordatorios { get; set; } = new List<Recordatorio>();
}
