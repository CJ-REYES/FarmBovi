using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Models;

namespace FarmBovi.Api.DTOs;

public sealed class RecordatorioRequest : IValidatableObject
{
    [StringLength(36, ErrorMessage = "idRancho admite hasta 36 caracteres.")]
    public string? IdRancho { get; init; }

    [StringLength(36, ErrorMessage = "idAnimal admite hasta 36 caracteres.")]
    public string? IdAnimal { get; init; }

    [StringLength(36, ErrorMessage = "idLote admite hasta 36 caracteres.")]
    public string? IdLote { get; init; }

    [StringLength(36, ErrorMessage = "idTratamiento admite hasta 36 caracteres.")]
    public string? IdTratamiento { get; init; }

    [StringLength(36, ErrorMessage = "idResponsable admite hasta 36 caracteres.")]
    public string? IdResponsable { get; init; }

    [Required(ErrorMessage = "El tipo de recordatorio es obligatorio.")]
    [StringLength(35, ErrorMessage = "El tipo admite hasta 35 caracteres.")]
    public string Tipo { get; init; } = string.Empty;

    [Required(ErrorMessage = "La descripción del recordatorio es obligatoria.")]
    [StringLength(250, ErrorMessage = "La descripción admite hasta 250 caracteres.")]
    public string Descripcion { get; init; } = string.Empty;

    [Required(ErrorMessage = "La fecha programada es obligatoria.")]
    public DateTime FechaProgramada { get; init; } = DateTime.UtcNow;

    [Required(ErrorMessage = "El estado es obligatorio.")]
    [StringLength(25, ErrorMessage = "El estado admite hasta 25 caracteres.")]
    public string Estado { get; init; } = "Pendiente";

    public DateTime? FechaCompletado { get; init; }

    [StringLength(36, ErrorMessage = "idAutor admite hasta 36 caracteres.")]
    public string? IdAutor { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        var hasAnimal = !string.IsNullOrWhiteSpace(IdAnimal);
        var hasLote = !string.IsNullOrWhiteSpace(IdLote);

        // Regla 12: Recordatorio puede ser general del rancho, individual o por lote; animal y lote son excluyentes.
        if (hasAnimal && hasLote)
        {
            yield return new ValidationResult(
                "El recordatorio puede ser general del rancho, individual o por lote; animal y lote son excluyentes (Regla 12).",
                [nameof(IdAnimal), nameof(IdLote)]);
        }

        if (!string.IsNullOrWhiteSpace(IdTratamiento) && hasLote)
        {
            yield return new ValidationResult(
                "Un recordatorio vinculado a un tratamiento individual no puede asignarse por lote (Regla 12).",
                [nameof(IdTratamiento), nameof(IdLote)]);
        }

        if (string.IsNullOrWhiteSpace(Tipo))
        {
            yield return new ValidationResult("El tipo de recordatorio es obligatorio.", [nameof(Tipo)]);
        }

        if (string.IsNullOrWhiteSpace(Descripcion))
        {
            yield return new ValidationResult("La descripción del recordatorio es obligatoria.", [nameof(Descripcion)]);
        }
    }
}

public sealed record RecordatorioResponse(
    string IdRecordatorio,
    string IdRancho,
    string? IdAnimal,
    string? AnimalArete,
    string? AnimalNombre,
    string? IdLote,
    string? IdTratamiento,
    string? TratamientoProducto,
    string? IdResponsable,
    string Tipo,
    string Descripcion,
    DateTime FechaProgramada,
    string Estado,
    DateTime? FechaCompletado,
    string IdAutor,
    DateTime CreadoEn,
    long VersionRegistro,
    DateTime? EliminadoEn)
{
    public static RecordatorioResponse From(
        Recordatorio entity,
        Cattle? cattle,
        string? tratamientoProducto) => new(
        entity.IdRecordatorio,
        entity.IdRancho,
        entity.IdAnimal,
        cattle?.EarTag,
        cattle?.Name,
        entity.IdLote,
        entity.IdTratamiento,
        tratamientoProducto,
        entity.IdResponsable,
        entity.Tipo,
        entity.Descripcion,
        entity.FechaProgramada,
        entity.Estado,
        entity.FechaCompletado,
        entity.IdAutor,
        entity.CreadoEn,
        entity.VersionRegistro,
        entity.EliminadoEn);
}
