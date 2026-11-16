namespace FarmBovi.Api.Models;

public sealed class RegistroOperacionSync
{
    public Guid IdOperacion { get; set; }
    public Guid IdUsuario { get; set; }
    public Guid IdRancho { get; set; }
    public string IdDispositivo { get; set; } = string.Empty;
    public string HashSolicitud { get; set; } = string.Empty;
    public string ResultadoJson { get; set; } = string.Empty;
    public DateTime ProcesadoEn { get; set; } = DateTime.UtcNow;
}
