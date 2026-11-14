namespace FarmBovi.Api.Models;

public sealed class CambioServidor
{
    public long IdCambioRemoto { get; set; }
    public int IdRancho { get; set; }
    public string? IdOperacion { get; set; }
    public string Entidad { get; set; } = string.Empty;
    public string IdRegistro { get; set; } = string.Empty;
    public string Accion { get; set; } = string.Empty;
    public long VersionRegistro { get; set; }
    public string DatosJson { get; set; } = string.Empty;
    public DateTime FechaCambio { get; set; } = DateTime.UtcNow;
}
