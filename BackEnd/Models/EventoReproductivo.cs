namespace FarmBovi.Api.Models;

/// <summary>
/// Evento del ciclo reproductivo asociado a un animal del hato
/// (detección de celo, servicio o monta, inseminación, diagnóstico/confirmación de gestación,
/// parto, pérdida gestacional, secado o destete).
/// </summary>
public sealed class EventoReproductivo
{
    public Guid IdEventoReproductivo { get; set; } = Guid.NewGuid();
    public Guid IdAnimal { get; set; }
    public Guid? IdSemental { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public DateTime Fecha { get; set; } = DateTime.UtcNow;
    public string? Resultado { get; set; }
    public string? Observaciones { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
