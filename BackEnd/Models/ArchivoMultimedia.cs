namespace FarmBovi.Api.Models;

/// <summary>
/// Metadatos de archivos multimedia sincronizados (fotos de perfil de bovinos, pesaje BoviScale, documentos).
/// En la base de datos ÚNICAMENTE se guarda la ruta relativa en disco (<see cref="RutaArchivo"/>),
/// nunca los bytes binarios ni Base64.
/// </summary>
public sealed class ArchivoMultimedia
{
    public Guid IdArchivo { get; set; } = Guid.NewGuid();
    public Guid IdRancho { get; set; }
    public Guid? IdAnimal { get; set; }
    public string EntidadRelacionada { get; set; } = "cattle";
    public Guid? IdEntidadRelacionada { get; set; }
    public string Tipo { get; set; } = "FotoPerfil";
    public string NombreArchivo { get; set; } = string.Empty;
    public string MimeType { get; set; } = "image/jpeg";
    public long TamanoBytes { get; set; }
    public string? ChecksumSha256 { get; set; }

    /// <summary>
    /// Ruta relativa en el servidor (ej. `public/imagenes/perfil-ganado/{id}/...`).
    /// </summary>
    public string RutaArchivo { get; set; } = string.Empty;

    public DateTime FechaCaptura { get; set; } = DateTime.UtcNow;
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
