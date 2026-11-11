namespace FarmBovi.Api.Models;

public sealed class Lote
{
    public int IdLote { get; set; }
    public int IdRancho { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string? Ubicacion { get; set; }
    public string Estado { get; set; } = string.Empty;
    public int IdAutor { get; set; }
    public DateTime FechaCreacion { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
