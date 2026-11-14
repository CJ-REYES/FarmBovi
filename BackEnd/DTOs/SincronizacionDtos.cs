using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace FarmBovi.Api.DTOs;

public sealed class OperacionSyncRequest
{
    [Required(ErrorMessage = "El identificador de operación (idOperacion) es obligatorio.")]
    [MaxLength(36)]
    public string IdOperacion { get; set; } = string.Empty;

    [Required]
    public int IdUsuario { get; set; }

    [Required]
    public int IdRancho { get; set; }

    [MaxLength(80)]
    public string IdDispositivo { get; set; } = "dispositivo-movil";

    [Required(ErrorMessage = "La entidad es obligatoria.")]
    [MaxLength(80)]
    public string Entidad { get; set; } = string.Empty;

    [MaxLength(36)]
    public string? IdRegistro { get; set; }

    [Required(ErrorMessage = "La acción (CREATE, UPDATE o DELETE) es obligatoria.")]
    [MaxLength(20)]
    public string Accion { get; set; } = string.Empty;

    public long? VersionBase { get; set; }

    public JsonElement Datos { get; set; }
}

public sealed record OperacionSyncResponse(
    string IdOperacion,
    string Entidad,
    string IdRegistro,
    string Accion,
    long VersionResultante,
    bool DuplicadoIgnorado,
    DateTime AplicadoEn,
    JsonElement EstadoServidor);

public sealed record CampoConflictoDto(
    string Campo,
    JsonElement ValorServidor,
    JsonElement ValorCliente);

public sealed record ConflictoSyncResponse(
    string TipoConflicto,
    string Mensaje,
    string IdOperacion,
    string Entidad,
    string IdRegistro,
    long? VersionEnviada,
    long VersionServidor,
    IReadOnlyList<CampoConflictoDto> CamposModificados,
    JsonElement? EstadoServidor);
