namespace FarmBovi.Api.Models;

public sealed class Recordatorio
{
    public int IdRecordatorio { get; set; }
    public int IdRancho { get; set; }
    public int? IdAnimal { get; set; }
    public int? IdLote { get; set; }
    public int? IdTratamiento { get; set; }
    public int? IdResponsable { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public string Descripcion { get; set; } = string.Empty;
    public DateTime FechaProgramada { get; set; }
    public string Estado { get; set; } = string.Empty;
    public DateTime? FechaCompletado { get; set; }
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
