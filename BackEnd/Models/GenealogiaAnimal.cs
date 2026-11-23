namespace FarmBovi.Api.Models;

/// <summary>
/// Relación genealógica (parentesco) de un animal descendiente con su padre y/o madre.
/// </summary>
public sealed class GenealogiaAnimal
{
    public Guid IdGenealogia { get; set; } = Guid.NewGuid();
    public Guid IdAnimal { get; set; }
    public Guid? IdPadre { get; set; }
    public Guid? IdMadre { get; set; }
    public string? Observaciones { get; set; }
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
