using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed record ArchivoMultimediaDto(
    Guid IdArchivo,
    Guid IdRancho,
    Guid? IdAnimal,
    string EntidadRelacionada,
    Guid? IdEntidadRelacionada,
    string Tipo,
    string NombreArchivo,
    string MimeType,
    long TamanoBytes,
    string? ChecksumSha256,
    string RutaArchivo,
    string UrlPublica,
    DateTime FechaCaptura,
    DateTime CreadoEn,
    long VersionRegistro,
    DateTime? EliminadoEn);

public sealed class UploadArchivoMultimediaForm
{
    public IFormFile? Archivo { get; set; }
    public Guid? IdArchivo { get; set; }
    public Guid? IdRancho { get; set; }
    public Guid? IdAnimal { get; set; }

    [MaxLength(40)]
    public string? EntidadRelacionada { get; set; }

    public Guid? IdEntidadRelacionada { get; set; }

    [MaxLength(30)]
    public string? Tipo { get; set; }

    [MaxLength(255)]
    public string? NombreArchivo { get; set; }

    [MaxLength(64)]
    public string? ChecksumSha256 { get; set; }

    public DateTime? FechaCaptura { get; set; }
}
