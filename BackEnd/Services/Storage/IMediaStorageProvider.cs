namespace FarmBovi.Api.Services.Storage;

/// <summary>
/// Contrato de estrategia física para persistir y recuperar binarios multimedia privados.
/// Mantiene totalmente desacoplados los metadatos relacionales (<c>ArchivoMultimedia</c>)
/// de la implementación física (sistema de archivos privado local, S3, Azure Blob Storage, GCS, etc.).
/// </summary>
public interface IMediaStorageProvider
{
    /// <summary>
    /// Nombre canónico del proveedor físico (ej. <c>LocalFileSystem</c>).
    /// </summary>
    string ProviderName { get; }

    /// <summary>
    /// Almacena el flujo binario de forma segura y sin sobrescrituras accidentales,
    /// aplicando límite estricto de tamaño y calculando SHA-256 del contenido real almacenado.
    /// </summary>
    Task<MediaStoreResult> SaveAsync(MediaStoreRequest request, CancellationToken ct = default);

    /// <summary>
    /// Abre un flujo de solo lectura para un objeto previamente almacenado.
    /// Devuelve <c>null</c> si no existe o si la ubicación no es válida/segura.
    /// </summary>
    Task<MediaReadResult?> OpenReadAsync(string storageLocation, string contentType, CancellationToken ct = default);

    /// <summary>
    /// Elimina físicamente el objeto almacenado si existe. Devuelve <c>true</c> si se eliminó.
    /// </summary>
    Task<bool> DeleteAsync(string storageLocation, CancellationToken ct = default);

    /// <summary>
    /// Verifica si el objeto existe físicamente en el proveedor.
    /// </summary>
    Task<bool> ExistsAsync(string storageLocation, CancellationToken ct = default);
}

public sealed record MediaStoreRequest(
    Guid IdArchivo,
    Guid IdRancho,
    Guid? IdAnimal,
    string Categoria,
    string CanonicalExtension,
    string RealMimeType,
    long MaxAllowedBytes,
    Stream ContentStream);

public sealed record MediaStoreResult(
    bool Ok,
    string? StorageLocation,
    string ProviderName,
    long BytesWritten,
    string? Sha256,
    string? Error = null,
    bool IsTooLarge = false);

public sealed record MediaReadResult(
    Stream Content,
    string ContentType,
    long Length);
