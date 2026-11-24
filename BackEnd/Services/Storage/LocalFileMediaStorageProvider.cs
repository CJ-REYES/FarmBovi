using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace FarmBovi.Api.Services.Storage;

/// <summary>
/// Estrategia física de almacenamiento en disco privado local (<c>App_Data/media</c> por defecto),
/// fuera de <c>wwwroot</c> y fuera de carpetas públicas.
/// Garantiza:
/// <list type="bullet">
/// <item>Rutas físicas generadas exclusivamente por el servidor con GUIDs y nonce criptográfico.</item>
/// <item>Protección estricta contra path traversal y escape de directorio raíz.</item>
/// <item>Creación exclusiva (<see cref="FileMode.CreateNew"/>) para impedir sobrescrituras accidentales.</item>
/// <item>Límite duro de bytes durante la escritura y cálculo real de SHA-256 en el servidor.</item>
/// </list>
/// </summary>
public sealed class LocalFileMediaStorageProvider : IMediaStorageProvider
{
    public const string ProviderId = "LocalFileSystem";

    private static readonly Dictionary<string, string> AllowedExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png",
            [".webp"] = "image/webp"
        };

    private static readonly HashSet<string> AllowedCategories = new(StringComparer.Ordinal)
    {
        "perfil-ganado",
        "pesaje-ganado",
        "documentos-ganado"
    };

    private readonly string _contentRoot;
    private readonly string _privateRoot;
    private readonly string _legacyPublicImagesRoot;

    public LocalFileMediaStorageProvider(IWebHostEnvironment env, IOptions<MediaStorageOptions> options)
        : this(env.ContentRootPath, options.Value)
    {
    }

    public LocalFileMediaStorageProvider(string contentRootPath, MediaStorageOptions options)
    {
        _contentRoot = Path.GetFullPath(contentRootPath);
        var configuredRoot = string.IsNullOrWhiteSpace(options.PrivateRootPath)
            ? Path.Combine("App_Data", "media")
            : options.PrivateRootPath.Trim();

        _privateRoot = Path.GetFullPath(
            Path.IsPathRooted(configuredRoot)
                ? configuredRoot
                : Path.Combine(_contentRoot, configuredRoot));

        // Blindaje defensivo: nunca permitir configurar el almacén privado dentro de wwwroot.
        var wwwroot = Path.GetFullPath(Path.Combine(_contentRoot, "wwwroot"));
        if (IsInsideOrEqual(_privateRoot, wwwroot))
        {
            throw new InvalidOperationException(
                "MediaStorage:PrivateRootPath no puede ubicarse dentro de wwwroot.");
        }

        _legacyPublicImagesRoot = Path.GetFullPath(Path.Combine(_contentRoot, "public", "imagenes"));
    }

    public string ProviderName => ProviderId;

    /// <summary>Directorio raíz privado configurado (útil para diagnósticos y pruebas).</summary>
    public string PrivateRootPath => _privateRoot;

    public async Task<MediaStoreResult> SaveAsync(MediaStoreRequest request, CancellationToken ct = default)
    {
        if (request.IdArchivo == Guid.Empty || request.IdRancho == Guid.Empty)
            return Fail("Los identificadores internos de archivo y rancho son obligatorios.");

        var category = NormalizeCategory(request.Categoria);
        if (!AllowedExtensions.ContainsKey(request.CanonicalExtension))
            return Fail("Extensión canónica no permitida para almacenamiento físico.");

        var canonicalExt = request.CanonicalExtension.ToLowerInvariant();
        var ranchFolder = request.IdRancho.ToString("N");
        var ownerFolder = (request.IdAnimal is { } aId && aId != Guid.Empty ? aId : request.IdRancho).ToString("N");

        var targetDir = Path.GetFullPath(Path.Combine(_privateRoot, ranchFolder, category, ownerFolder));
        if (!IsInsideRoot(targetDir, _privateRoot))
            return Fail("Ruta de almacenamiento inválida.");

        Directory.CreateDirectory(targetDir);

        const int maxCollisionAttempts = 4;
        for (var attempt = 0; attempt < maxCollisionAttempts; attempt++)
        {
            var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant();
            var generatedFileName =
                $"{request.IdArchivo:N}_{DateTime.UtcNow:yyyyMMddHHmmssfff}_{nonce}{canonicalExt}";

            var physicalPath = Path.GetFullPath(Path.Combine(targetDir, generatedFileName));
            if (!IsInsideRoot(physicalPath, _privateRoot))
                return Fail("Ruta física fuera del directorio privado autorizado.");

            var relativeKey = $"{ranchFolder}/{category}/{ownerFolder}/{generatedFileName}";

            FileStream? targetStream = null;
            try
            {
                // FileMode.CreateNew garantiza atómicamente a nivel de sistema operativo
                // que jamás se sobrescriba un archivo existente.
                targetStream = new FileStream(
                    physicalPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    bufferSize: 64 * 1024,
                    useAsync: true);
            }
            catch (IOException) when (File.Exists(physicalPath))
            {
                // Colisión extremadamente improbable: reintentar con nuevo nonce sin sobrescribir
                continue;
            }

            long totalWritten = 0;
            var completed = false;
            try
            {
                await using (targetStream)
                {
                    using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                    var buffer = new byte[64 * 1024];

                    if (request.ContentStream.CanSeek)
                        request.ContentStream.Position = 0;

                    while (true)
                    {
                        var read = await request.ContentStream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
                        if (read == 0) break;

                        totalWritten += read;
                        if (totalWritten > request.MaxAllowedBytes)
                        {
                            var maxMb = Math.Round(request.MaxAllowedBytes / (1024d * 1024d), 2);
                            return new MediaStoreResult(
                                Ok: false,
                                StorageLocation: null,
                                ProviderName: ProviderName,
                                BytesWritten: 0,
                                Sha256: null,
                                Error: $"El archivo excede el tamaño máximo permitido de {maxMb:0.##} MB.",
                                IsTooLarge: true);
                        }

                        hasher.AppendData(buffer, 0, read);
                        await targetStream.WriteAsync(buffer.AsMemory(0, read), ct);
                    }

                    if (totalWritten <= 0)
                        return Fail("El archivo recibido está vacío.");

                    await targetStream.FlushAsync(ct);
                    var hashHex = Convert.ToHexString(hasher.GetHashAndReset()).ToLowerInvariant();
                    completed = true;

                    return new MediaStoreResult(
                        Ok: true,
                        StorageLocation: relativeKey,
                        ProviderName: ProviderName,
                        BytesWritten: totalWritten,
                        Sha256: hashHex);
                }
            }
            finally
            {
                if (!completed)
                    TryDeletePhysicalFile(physicalPath);
            }
        }

        return Fail("No se pudo reservar una ubicación única para almacenar el archivo sin sobrescritura.");
    }

    public Task<MediaReadResult?> OpenReadAsync(string storageLocation, string contentType, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var resolved = ResolveSafePhysicalPath(storageLocation);
        if (resolved is null || !File.Exists(resolved.Value.FullPath))
            return Task.FromResult<MediaReadResult?>(null);

        var fileInfo = new FileInfo(resolved.Value.FullPath);
        if (!fileInfo.Exists || fileInfo.Length <= 0)
            return Task.FromResult<MediaReadResult?>(null);

        var safeContentType = !string.IsNullOrWhiteSpace(contentType)
            ? contentType
            : resolved.Value.ContentType;

        var stream = new FileStream(
            resolved.Value.FullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 64 * 1024,
            useAsync: true);

        return Task.FromResult<MediaReadResult?>(new MediaReadResult(stream, safeContentType, fileInfo.Length));
    }

    public Task<bool> DeleteAsync(string storageLocation, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var resolved = ResolveSafePhysicalPath(storageLocation);
        if (resolved is null || !File.Exists(resolved.Value.FullPath))
            return Task.FromResult(false);

        var deleted = TryDeletePhysicalFile(resolved.Value.FullPath);
        if (deleted)
        {
            CleanupEmptyAncestorDirectories(Path.GetDirectoryName(resolved.Value.FullPath), resolved.Value.RootPath);
        }

        return Task.FromResult(deleted);
    }

    public Task<bool> ExistsAsync(string storageLocation, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var resolved = ResolveSafePhysicalPath(storageLocation);
        return Task.FromResult(resolved is not null && File.Exists(resolved.Value.FullPath));
    }

    /// <summary>
    /// Resuelve y valida una clave relativa de almacenamiento impidiendo cualquier path traversal,
    /// rutas absolutas, caracteres de control o extensiones no permitidas.
    /// </summary>
    public (string FullPath, string RootPath, string ContentType)? ResolveSafePhysicalPath(string? storageLocation)
    {
        if (string.IsNullOrWhiteSpace(storageLocation))
            return null;

        var trimmed = storageLocation.Trim();
        if (trimmed.Contains("..", StringComparison.Ordinal) ||
            trimmed.Contains('\\') ||
            trimmed.Contains(':') ||
            trimmed.Contains('\0') ||
            trimmed.StartsWith('/'))
        {
            return null;
        }

        foreach (var ch in trimmed)
        {
            if (char.IsControl(ch))
                return null;
        }

        string root;
        string candidate;
        if (trimmed.StartsWith("public/imagenes/", StringComparison.OrdinalIgnoreCase))
        {
            // Compatibilidad de lectura/eliminación para registros históricos migrados
            // (siempre autenticados y autorizados por rancho en MediaController).
            root = _legacyPublicImagesRoot;
            candidate = Path.GetFullPath(Path.Combine(_contentRoot, trimmed));
        }
        else
        {
            root = _privateRoot;
            candidate = Path.GetFullPath(Path.Combine(_privateRoot, trimmed));
        }

        if (!IsInsideRoot(candidate, root))
            return null;

        var ext = Path.GetExtension(candidate);
        if (!AllowedExtensions.TryGetValue(ext, out var contentType))
            return null;

        return (candidate, root, contentType);
    }

    public static string ResolveCategory(string? tipo)
    {
        var norm = (tipo ?? string.Empty).Trim().ToLowerInvariant();
        var category = norm switch
        {
            "boviscalevision" or "pesaje" or "pesaje-ganado" => "pesaje-ganado",
            "documento" or "documentos" or "documentos-ganado" => "documentos-ganado",
            _ => "perfil-ganado"
        };
        return AllowedCategories.Contains(category) ? category : "perfil-ganado";
    }

    private static string NormalizeCategory(string? category) => ResolveCategory(category);

    private static bool IsInsideRoot(string fullPath, string rootPath)
    {
        var rootWithSep = rootPath.EndsWith(Path.DirectorySeparatorChar)
            ? rootPath
            : rootPath + Path.DirectorySeparatorChar;
        return fullPath.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsInsideOrEqual(string fullPath, string rootPath)
    {
        var normPath = fullPath.TrimEnd(Path.DirectorySeparatorChar);
        var normRoot = rootPath.TrimEnd(Path.DirectorySeparatorChar);
        return string.Equals(normPath, normRoot, StringComparison.OrdinalIgnoreCase) ||
               IsInsideRoot(fullPath, rootPath);
    }

    private static bool TryDeletePhysicalFile(string physicalPath)
    {
        try
        {
            if (!File.Exists(physicalPath))
                return false;

            File.Delete(physicalPath);
            return true;
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static void CleanupEmptyAncestorDirectories(string? directory, string stopAtRoot)
    {
        var current = directory;
        var normalizedRoot = Path.GetFullPath(stopAtRoot).TrimEnd(Path.DirectorySeparatorChar);

        while (!string.IsNullOrWhiteSpace(current))
        {
            var normalizedCurrent = Path.GetFullPath(current).TrimEnd(Path.DirectorySeparatorChar);
            if (string.Equals(normalizedCurrent, normalizedRoot, StringComparison.OrdinalIgnoreCase) ||
                !IsInsideRoot(normalizedCurrent, normalizedRoot))
            {
                break;
            }

            try
            {
                if (!Directory.Exists(normalizedCurrent) ||
                    Directory.EnumerateFileSystemEntries(normalizedCurrent).Any())
                {
                    break;
                }

                Directory.Delete(normalizedCurrent);
                current = Path.GetDirectoryName(normalizedCurrent);
            }
            catch (IOException)
            {
                break;
            }
        }
    }

    private MediaStoreResult Fail(string error) =>
        new(false, null, ProviderName, 0, null, error);
}
