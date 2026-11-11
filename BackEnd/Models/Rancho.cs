namespace FarmBovi.Api.Models;

public sealed class Rancho
{
    public int IdRancho { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string UbicacionGeneral { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
