namespace FarmBovi.Api.Models;

public sealed class RegistroSyncServidor
{
    public string IdOperacion { get; set; } = string.Empty;
    public int IdUsuario { get; set; }
    public int IdRancho { get; set; }
    public string IdDispositivo { get; set; } = string.Empty;
    public string HashSolicitud { get; set; } = string.Empty;
    public string Entidad { get; set; } = string.Empty;
    public string IdRegistro { get; set; } = string.Empty;
    public string Resultado { get; set; } = string.Empty;
    public long VersionResultante { get; set; }
    public DateTime AplicadoEn { get; set; } = DateTime.UtcNow;
}
