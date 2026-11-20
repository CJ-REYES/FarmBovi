namespace FarmBovi.Api.Models;

public sealed class Animal
{
    public Guid IdAnimal { get; set; } = Guid.NewGuid();
    public Guid IdRancho { get; set; }
    public Guid? IdLote { get; set; }
    public string Arete { get; set; } = string.Empty;
    public string Raza { get; set; } = string.Empty;
    public string Sexo { get; set; } = string.Empty;
    public DateTime? FechaNacimiento { get; set; }
    public DateTime FechaIngreso { get; set; }
    public string Procedencia { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public DateTime? FechaSalida { get; set; }
    public string? Observaciones { get; set; }
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
