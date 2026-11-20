namespace FarmBovi.Api.Models;

public sealed class Rancho
{
    public Guid IdRancho { get; set; } = Guid.NewGuid();
    public string Nombre { get; set; } = string.Empty;
    public string UbicacionGeneral { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
