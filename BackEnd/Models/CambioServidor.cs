namespace FarmBovi.Api.Models;

public sealed class CambioServidor
{
    public long IdCambio { get; set; }
    public string Entidad { get; set; } = string.Empty;
    public string IdRegistro { get; set; } = string.Empty;
    public int? IdRancho { get; set; }
    public string Operacion { get; set; } = string.Empty;
    public DateTime OcurrioEn { get; set; }
    public string DatosJson { get; set; } = string.Empty;
}
