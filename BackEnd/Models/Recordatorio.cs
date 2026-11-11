namespace FarmBovi.Api.Models;

public sealed class Recordatorio
{
    public string IdRecordatorio { get; set; } = Guid.NewGuid().ToString();
    public string IdRancho { get; set; } = "00000000-0000-0000-0000-000000000100";
    public string? IdAnimal { get; set; }
    public string? IdLote { get; set; }
    public string? IdTratamiento { get; set; }
    public string? IdResponsable { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public string Descripcion { get; set; } = string.Empty;
    public DateTime FechaProgramada { get; set; } = DateTime.UtcNow;
    public string Estado { get; set; } = "Pendiente";
    public DateTime? FechaCompletado { get; set; }
    public string IdAutor { get; set; } = "00000000-0000-0000-0000-000000000001";
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }

    public Tratamiento? Tratamiento { get; set; }
}
