namespace FarmBovi.Api.Models;

public sealed class CambioAuditoria
{
    public string IdCambio { get; set; } = Guid.NewGuid().ToString();
    public int IdRancho { get; set; }
    public int IdUsuario { get; set; }
    public string? IdOperacion { get; set; }
    public string Entidad { get; set; } = string.Empty;
    public string IdRegistro { get; set; } = string.Empty;
    public string Accion { get; set; } = string.Empty;
    public DateTime Fecha { get; set; } = DateTime.UtcNow;
    public string Origen { get; set; } = "SYNC_MOVIL";
    public string? Antes { get; set; }
    public string? Despues { get; set; }
}
