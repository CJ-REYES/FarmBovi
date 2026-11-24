namespace FarmBovi.Api.Models;

/// <summary>
/// Tabla de deduplicación e idempotencia para operaciones Push recibidas en el servidor.
/// </summary>
public sealed class RegistroSyncServidor
{
    public Guid IdOperacion { get; set; }
    
    // Cambiado de Guid a int para que coincida con el ID de usuario del JWT y los controladores
    public int IdUsuario { get; set; }
    
    public Guid IdRancho { get; set; }
    public string IdDispositivo { get; set; } = string.Empty;
    public string HashSolicitud { get; set; } = string.Empty;
    public string Entidad { get; set; } = string.Empty;
    public Guid IdRegistro { get; set; }
    public string Resultado { get; set; } = "{}";
    public long VersionResultante { get; set; }
    public DateTime AplicadoEn { get; set; } = DateTime.UtcNow;
}