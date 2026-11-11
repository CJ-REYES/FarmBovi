namespace FarmBovi.Api.Models;

public sealed class EventoSanitario
{
    public string IdEventoSanitario { get; set; } = Guid.NewGuid().ToString();
    public string IdAnimal { get; set; } = string.Empty;
    public string Tipo { get; set; } = string.Empty;
    public DateTime Fecha { get; set; } = DateTime.UtcNow;
    public string? Sintomas { get; set; }
    public string? Diagnostico { get; set; }
    public string? ProfesionalDiagnostico { get; set; }
    public string? EvidenciaDiagnosticoUri { get; set; }
    public string Responsable { get; set; } = string.Empty;
    public string? Observaciones { get; set; }
    public string IdAutor { get; set; } = "00000000-0000-0000-0000-000000000001";
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }

    public ICollection<Tratamiento> Tratamientos { get; set; } = new List<Tratamiento>();
}
