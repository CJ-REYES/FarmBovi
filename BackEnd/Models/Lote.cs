namespace FarmBovi.Api.Models;

public sealed class Lote
{
    public Guid IdLote { get; set; } = Guid.NewGuid();
    public Guid IdRancho { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string? Ubicacion { get; set; }
    public string Estado { get; set; } = string.Empty;
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
