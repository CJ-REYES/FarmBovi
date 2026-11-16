namespace FarmBovi.Api.Models;

public sealed class Recordatorio
{
    public Guid IdRecordatorio { get; set; } = Guid.NewGuid();
    public Guid IdRancho { get; set; }
    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }
    public Guid? IdTratamiento { get; set; }
    public Guid? IdResponsable { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public string Descripcion { get; set; } = string.Empty;
    public DateTime FechaProgramada { get; set; }
    public string Estado { get; set; } = string.Empty;
    public DateTime? FechaCompletado { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
