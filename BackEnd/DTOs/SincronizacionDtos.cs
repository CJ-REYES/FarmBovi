using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace FarmBovi.Api.DTOs;

public sealed class OperacionSyncRequest
{
    [Required(ErrorMessage = "El identificador de operación (idOperacion) es obligatorio.")]
    public Guid IdOperacion { get; set; }

    /// <summary>
    /// Ignorado por seguridad (Punto 4): la identidad se extrae exclusivamente del JWT.
    /// </summary>
    public Guid? IdUsuario { get; set; }

    [Required(ErrorMessage = "El identificador del rancho (idRancho) es obligatorio.")]
    public Guid IdRancho { get; set; }

    [Required(ErrorMessage = "El identificador del dispositivo (idDispositivo) es obligatorio.")]
    [MaxLength(120)]
    public string IdDispositivo { get; set; } = string.Empty;

    [Required(ErrorMessage = "La entidad es obligatoria.")]
    [MaxLength(80)]
    public string Entidad { get; set; } = string.Empty;

    public Guid? IdRegistro { get; set; }

    [MaxLength(20)]
    public string? Operacion { get; set; }

    [MaxLength(20)]
    public string? Accion { get; set; }

    public long? VersionBase { get; set; }

    public DateTime? FechaLocal { get; set; }

    public JsonElement Payload { get; set; }

    public JsonElement Datos { get; set; }

    public string? ResolverOperacionBruta() =>
        !string.IsNullOrWhiteSpace(Operacion) ? Operacion : Accion;

    public JsonElement ResolverPayload() =>
        Payload.ValueKind != JsonValueKind.Undefined ? Payload : Datos;
}

public sealed record OperacionSyncResponse(
    Guid IdOperacion,
    string Entidad,
    Guid IdRegistro,
    string Operacion,
    long Version,
    Guid IdCambio,
    DateTime OcurrioEn,
    bool DuplicadoIgnorado,
    JsonElement? Datos)
{
    public long VersionResultante => Version;
    public DateTime AplicadoEn => OcurrioEn;
    public JsonElement? EstadoServidor => Datos;
}

public sealed record CampoConflictoDto(
    string Campo,
    JsonElement ValorServidor,
    JsonElement ValorCliente);

public sealed record ConflictoSyncResponse(
    string TipoConflicto,
    string Mensaje,
    Guid IdOperacion,
    string Entidad,
    Guid IdRegistro,
    long? VersionEnviada,
    long VersionServidor,
    IReadOnlyList<CampoConflictoDto> CamposModificados,
    JsonElement? EstadoServidor)
{
    public long? VersionBase => VersionEnviada;
    public JsonElement? DatosServidor => EstadoServidor;
}
