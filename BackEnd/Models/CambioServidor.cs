namespace FarmBovi.Api.Models;

public sealed class CambioServidor
{
    public Guid IdCambio { get; set; } = Guid.NewGuid();
    public Guid IdRancho { get; set; }
    public string Entidad { get; set; } = string.Empty;
    public Guid IdRegistro { get; set; }
    public string Operacion { get; set; } = string.Empty;
    public long Version { get; set; }
    public DateTime OcurrioEn { get; set; } = DateTime.UtcNow;
    public Guid? IdUsuario { get; set; }
    public string? Datos { get; set; }
}
