namespace FarmBovi.Api.Models;

public sealed class Cattle
{
    public int Id { get; set; }
    public string EarTag { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Breed { get; set; } = string.Empty;
    public string Sex { get; set; } = "Hembra";
    public DateOnly? BirthDate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
