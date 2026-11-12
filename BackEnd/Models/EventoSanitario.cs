namespace FarmBovi.Api.Models;

public sealed class EventoSanitario
{
    public int IdEventoSanitario { get; set; }
    public int IdAnimal { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public DateTime Fecha { get; set; }
    public string? Sintomas { get; set; }
    public string? Diagnostico { get; set; }
    public string? ProfesionalDiagnostico { get; set; }
    public string? EvidenciaDiagnosticoUri { get; set; }
    public string Responsable { get; set; } = string.Empty;
    public string? Observaciones { get; set; }
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
