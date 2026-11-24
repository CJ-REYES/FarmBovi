namespace FarmBovi.Api.Services.Storage;

/// <summary>
/// Configuración de la estrategia física de almacenamiento multimedia privado.
/// Permite cambiar de directorio o de proveedor físico (LocalFileSystem, S3, AzureBlob, GCS)
/// sin modificar el modelo de metadatos ni los controladores.
/// </summary>
public sealed class MediaStorageOptions
{
    public const string SectionName = "MediaStorage";

    /// <summary>
    /// Identificador del proveedor activo (por defecto <c>LocalFileSystem</c>).
    /// </summary>
    public string Provider { get; set; } = "LocalFileSystem";

    /// <summary>
    /// Ruta raíz privada fuera de <c>wwwroot</c> y fuera de carpetas públicas.
    /// Si es relativa, se resuelve respecto a <c>IWebHostEnvironment.ContentRootPath</c>.
    /// </summary>
    public string PrivateRootPath { get; set; } = Path.Combine("App_Data", "media");

    /// <summary>
    /// Tamaño máximo permitido por archivo fotográfico en bytes (por defecto 10 MB).
    /// </summary>
    public long MaxFileSizeBytes { get; set; } = 10 * 1024 * 1024;
}
