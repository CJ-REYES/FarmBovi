namespace FarmBovi.Api.Models;

/// <summary>
/// Estados canónicos del ciclo de vida de un archivo multimedia en el servidor.
/// </summary>
public static class EstadosArchivoMultimedia
{
    public const string Pendiente = "Pendiente";
    public const string Disponible = "Disponible";
    public const string Eliminado = "Eliminado";
    public const string Error = "Error";

    public static readonly IReadOnlySet<string> Todos = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Pendiente,
        Disponible,
        Eliminado,
        Error
    };

    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "pendiente" => Pendiente,
            "disponible" => Disponible,
            "eliminado" => Eliminado,
            "error" => Error,
            _ => null
        };
    }
}

/// <summary>
/// Metadatos de archivos multimedia asociados a animales y ranchos (fotos de perfil,
/// capturas BoviScale Vision, documentos).
/// En la base de datos relacional ÚNICAMENTE se almacenan metadatos y la clave lógica de ubicación
/// (<see cref="RutaArchivo"/>) desacoplada del proveedor físico (<see cref="ProveedorAlmacenamiento"/>),
/// nunca los bytes binarios del archivo.
/// </summary>
public sealed class ArchivoMultimedia
{
    public Guid IdArchivo { get; set; } = Guid.NewGuid();
    public Guid IdRancho { get; set; }
    public Guid? IdAnimal { get; set; }
    public string EntidadRelacionada { get; set; } = "cattle";
    public Guid? IdEntidadRelacionada { get; set; }
    public string Tipo { get; set; } = "FotoPerfil";

    /// <summary>
    /// Nombre descriptivo sanitizado para visualización. Nunca se utiliza para construir rutas físicas.
    /// </summary>
    public string NombreArchivo { get; set; } = string.Empty;

    /// <summary>
    /// MIME real verificado mediante firma binaria (magic bytes), ej. <c>image/jpeg</c>, <c>image/png</c>, <c>image/webp</c>.
    /// </summary>
    public string MimeType { get; set; } = "image/jpeg";

    /// <summary>
    /// Extensión canónica verificada correspondiente al MIME real, ej. <c>.jpg</c>, <c>.png</c>, <c>.webp</c>.
    /// </summary>
    public string Extension { get; set; } = ".jpg";

    public long TamanoBytes { get; set; }
    public string? ChecksumSha256 { get; set; }

    /// <summary>
    /// Identificador del proveedor físico donde reside el objeto binario (ej. <c>LocalFileSystem</c>, futuro S3/AzureBlob/GCS).
    /// </summary>
    public string ProveedorAlmacenamiento { get; set; } = "LocalFileSystem";

    /// <summary>
    /// Clave relativa/ubicación lógica dentro del proveedor de almacenamiento físico.
    /// Generada exclusivamente por el servidor a partir de identificadores internos.
    /// </summary>
    public string RutaArchivo { get; set; } = string.Empty;

    /// <summary>
    /// Estado actual del archivo (<see cref="EstadosArchivoMultimedia"/>: Disponible, Pendiente, Eliminado, Error).
    /// </summary>
    public string Estado { get; set; } = EstadosArchivoMultimedia.Disponible;

    public DateTime FechaCaptura { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Marca temporal UTC en la que el archivo fue cargado y persistido en el servidor.
    /// </summary>
    public DateTime FechaCarga { get; set; } = DateTime.UtcNow;

    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
    public long VersionRegistro { get; set; } = 1;
    public DateTime? EliminadoEn { get; set; }
}
