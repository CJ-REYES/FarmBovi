namespace FarmBovi.Api.Models;

public sealed class EventoSanitario
{
    public Guid IdEventoSanitario { get; set; } = Guid.NewGuid();
    public Guid IdAnimal { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public DateTime Fecha { get; set; }
    public string? Sintomas { get; set; }
    public string? Diagnostico { get; set; }
    public string? ProfesionalDiagnostico { get; set; }
    public string? EvidenciaDiagnosticoUri { get; set; }
    public string Responsable { get; set; } = string.Empty;
    public string? Observaciones { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
