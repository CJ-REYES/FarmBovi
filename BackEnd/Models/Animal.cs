namespace FarmBovi.Api.Models;

public sealed class Animal
{
    public int IdAnimal { get; set; }
    public int IdRancho { get; set; }
    public int IdLote { get; set; }
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
    public DateTime FechaCreacion { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
