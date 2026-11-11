using System.ComponentModel.DataAnnotations;
using FarmBovi.Api.Models;

namespace FarmBovi.Api.DTOs;

public sealed class EventoSanitarioRequest : IValidatableObject
{
    [Required(ErrorMessage = "El identificador del animal (idAnimal) es obligatorio.")]
    [StringLength(36, ErrorMessage = "idAnimal admite hasta 36 caracteres.")]
    public string IdAnimal { get; init; } = string.Empty;

    [Required(ErrorMessage = "El tipo de evento sanitario es obligatorio.")]
    [StringLength(35, ErrorMessage = "El tipo admite hasta 35 caracteres.")]
    public string Tipo { get; init; } = string.Empty;

    [Required(ErrorMessage = "La fecha del evento sanitario es obligatoria.")]
    public DateTime Fecha { get; init; } = DateTime.UtcNow;

    public string? Sintomas { get; init; }

    public string? Diagnostico { get; init; }

    [StringLength(180, ErrorMessage = "El profesional del diagnóstico admite hasta 180 caracteres.")]
    public string? ProfesionalDiagnostico { get; init; }

    [StringLength(500, ErrorMessage = "La URI de evidencia diagnóstica admite hasta 500 caracteres.")]
    public string? EvidenciaDiagnosticoUri { get; init; }

    [Required(ErrorMessage = "El responsable del registro sanitario es obligatorio (Regla 11).")]
    [StringLength(180, ErrorMessage = "El responsable admite hasta 180 caracteres.")]
    public string Responsable { get; init; } = string.Empty;

    public string? Observaciones { get; init; }

    [StringLength(36, ErrorMessage = "idAutor admite hasta 36 caracteres.")]
    public string? IdAutor { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (string.IsNullOrWhiteSpace(IdAnimal))
        {
            yield return new ValidationResult("Debe especificar el animal del evento sanitario.", [nameof(IdAnimal)]);
        }
        if (string.IsNullOrWhiteSpace(Tipo))
        {
            yield return new ValidationResult("El tipo de evento sanitario no puede estar vacío.", [nameof(Tipo)]);
        }
        if (string.IsNullOrWhiteSpace(Responsable))
        {
            yield return new ValidationResult("El responsable del evento sanitario no puede estar vacío.", [nameof(Responsable)]);
        }
    }
}

public sealed class TratamientoRequest : IValidatableObject
{
    [Required(ErrorMessage = "El evento sanitario (idEventoSanitario) es obligatorio.")]
    [StringLength(36, ErrorMessage = "idEventoSanitario admite hasta 36 caracteres.")]
    public string IdEventoSanitario { get; init; } = string.Empty;

    [Required(ErrorMessage = "El producto o medicamento es obligatorio.")]
    [StringLength(150, ErrorMessage = "El producto admite hasta 150 caracteres.")]
    public string Producto { get; init; } = string.Empty;

    [Required(ErrorMessage = "La dosis es obligatoria.")]
    public decimal Dosis { get; init; }

    [Required(ErrorMessage = "La unidad de dosis es obligatoria.")]
    [StringLength(20, ErrorMessage = "La unidad de dosis admite hasta 20 caracteres.")]
    public string UnidadDosis { get; init; } = "ml";

    [StringLength(60, ErrorMessage = "La vía de administración admite hasta 60 caracteres.")]
    public string? ViaAdministracion { get; init; }

    [Required(ErrorMessage = "La frecuencia es obligatoria.")]
    [StringLength(80, ErrorMessage = "La frecuencia admite hasta 80 caracteres.")]
    public string Frecuencia { get; init; } = string.Empty;

    [Required(ErrorMessage = "La fecha de inicio es obligatoria.")]
    public DateTime FechaInicio { get; init; } = DateTime.UtcNow;

    public DateTime? FechaFin { get; init; }

    [Required(ErrorMessage = "El responsable del tratamiento es obligatorio.")]
    [StringLength(180, ErrorMessage = "El responsable admite hasta 180 caracteres.")]
    public string Responsable { get; init; } = string.Empty;

    [StringLength(500, ErrorMessage = "La URI de prescripción admite hasta 500 caracteres.")]
    public string? PrescripcionUri { get; init; }

    [Required(ErrorMessage = "El estado del tratamiento es obligatorio.")]
    [StringLength(25, ErrorMessage = "El estado admite hasta 25 caracteres.")]
    public string Estado { get; init; } = "En curso";

    [StringLength(36, ErrorMessage = "idAutor admite hasta 36 caracteres.")]
    public string? IdAutor { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Dosis <= 0)
        {
            yield return new ValidationResult("La dosis debe ser mayor que 0.", [nameof(Dosis)]);
        }
        if (FechaFin.HasValue && FechaFin.Value < FechaInicio)
        {
            yield return new ValidationResult("La fecha de fin no puede ser anterior a la fecha de inicio.", [nameof(FechaFin)]);
        }
        if (string.IsNullOrWhiteSpace(Producto))
        {
            yield return new ValidationResult("El producto es obligatorio.", [nameof(Producto)]);
        }
        if (string.IsNullOrWhiteSpace(Responsable))
        {
            yield return new ValidationResult("El responsable es obligatorio.", [nameof(Responsable)]);
        }
    }
}

public sealed record TratamientoResponse(
    string IdTratamiento,
    string IdEventoSanitario,
    string IdAnimal,
    string? AnimalArete,
    string? AnimalNombre,
    string Producto,
    decimal Dosis,
    string UnidadDosis,
    string? ViaAdministracion,
    string Frecuencia,
    DateTime FechaInicio,
    DateTime? FechaFin,
    string Responsable,
    string? PrescripcionUri,
    string Estado,
    string IdAutor,
    DateTime CreadoEn,
    long VersionRegistro,
    DateTime? EliminadoEn)
{
    public static TratamientoResponse From(Tratamiento entity, string idAnimal, Cattle? cattle) => new(
        entity.IdTratamiento,
        entity.IdEventoSanitario,
        idAnimal,
        cattle?.EarTag,
        cattle?.Name,
        entity.Producto,
        entity.Dosis,
        entity.UnidadDosis,
        entity.ViaAdministracion,
        entity.Frecuencia,
        entity.FechaInicio,
        entity.FechaFin,
        entity.Responsable,
        entity.PrescripcionUri,
        entity.Estado,
        entity.IdAutor,
        entity.CreadoEn,
        entity.VersionRegistro,
        entity.EliminadoEn);
}

public sealed record EventoSanitarioResponse(
    string IdEventoSanitario,
    string IdAnimal,
    string? AnimalArete,
    string? AnimalNombre,
    string Tipo,
    DateTime Fecha,
    string? Sintomas,
    string? Diagnostico,
    string? ProfesionalDiagnostico,
    string? EvidenciaDiagnosticoUri,
    string Responsable,
    string? Observaciones,
    string IdAutor,
    DateTime CreadoEn,
    long VersionRegistro,
    DateTime? EliminadoEn,
    IReadOnlyList<TratamientoResponse> Tratamientos)
{
    public static EventoSanitarioResponse From(EventoSanitario entity, Cattle? cattle) => new(
        entity.IdEventoSanitario,
        entity.IdAnimal,
        cattle?.EarTag,
        cattle?.Name,
        entity.Tipo,
        entity.Fecha,
        entity.Sintomas,
        entity.Diagnostico,
        entity.ProfesionalDiagnostico,
        entity.EvidenciaDiagnosticoUri,
        entity.Responsable,
        entity.Observaciones,
        entity.IdAutor,
        entity.CreadoEn,
        entity.VersionRegistro,
        entity.EliminadoEn,
        entity.Tratamientos
            .Where(t => t.EliminadoEn == null)
            .OrderByDescending(t => t.FechaInicio)
            .Select(t => TratamientoResponse.From(t, entity.IdAnimal, cattle))
            .ToList());
}
