namespace FarmBovi.Api.Services;

/// <summary>
/// Administra el almacenamiento físico de imágenes en disco bajo `public/imagenes/...`
/// (y conserva compatibilidad de lectura con archivos previos en `App_Data/uploads/...`).
/// En la base de datos ÚNICAMENTE se guarda la ruta relativa:
/// - `public/imagenes/perfil-usuario/{userId}/...`
/// - `public/imagenes/perfil-ganado/{animalId}/...`
/// - `public/imagenes/pesaje-ganado/{animalId}/...`
/// - `public/imagenes/documentos-ganado/{animalId}/...`
/// Y se transforma en URL pública (`/api/media/...`) para renderizarla en el Frontend.
/// </summary>
public sealed class ProfilePhotoStorageService
{
    public const long MaxProfilePhotoBytes = 5 * 1024 * 1024; // 5 MB
    public const long MaxPhotoBytes = MaxProfilePhotoBytes;
    public const long MaxMediaPhotoBytes = 10 * 1024 * 1024; // 10 MB

    private static readonly Dictionary<string, (string Extension, string ContentType)> AllowedMimeTypes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["image/jpeg"] = (".jpg", "image/jpeg"),
            ["image/jpg"] = (".jpg", "image/jpeg"),
            ["image/png"] = (".png", "image/png"),
            ["image/webp"] = (".webp", "image/webp")
        };

    private static readonly Dictionary<string, string> ContentTypeByExtension =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png",
            [".webp"] = "image/webp"
        };

    private readonly string _contentRoot;
    private readonly string _publicImagesRoot;
    private readonly string _legacyAppDataRoot;
    private readonly string _legacyUploadsRoot;

    public ProfilePhotoStorageService(IWebHostEnvironment env)
        : this(env.ContentRootPath)
    {
    }

    public ProfilePhotoStorageService(string contentRootPath)
    {
        _contentRoot = Path.GetFullPath(contentRootPath);
        _publicImagesRoot = Path.GetFullPath(Path.Combine(_contentRoot, "public", "imagenes"));
        _legacyAppDataRoot = Path.GetFullPath(Path.Combine(_contentRoot, "App_Data"));
        _legacyUploadsRoot = Path.GetFullPath(Path.Combine(_legacyAppDataRoot, "uploads"));
    }

    /// <summary>
    /// Transforma la ruta relativa guardada en la base de datos en una URL lista para
    /// renderizarse en el Frontend (`&lt;img src="..." /&gt;`).
    /// </summary>
    public static string? ToPublicUrlStatic(string? storedPath)
    {
        if (string.IsNullOrWhiteSpace(storedPath))
            return null;

        var trimmed = storedPath.Trim();
        if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }

        var normalized = trimmed.Replace('\\', '/').TrimStart('/');
        if (normalized.StartsWith("api/media/", StringComparison.OrdinalIgnoreCase))
            return $"/{normalized}";

        return $"/api/media/{normalized}";
    }

    public string? ToPublicUrl(string? storedPath) => ToPublicUrlStatic(storedPath);

    /// <summary>
    /// Resuelve la subcarpeta lógica dentro de `public/imagenes/` según el tipo de imagen.
    /// </summary>
    public static string ResolveCategoryFolder(string? tipo)
    {
        var norm = (tipo ?? string.Empty).Trim().ToLowerInvariant();
        return norm switch
        {
            "perfilusuario" or "perfil-usuario" or "usuario" => "perfil-usuario",
            "boviscalevision" or "pesaje" or "pesaje-ganado" or "pesage-ganado" => "pesaje-ganado",
            "documento" or "documentos" => "documentos-ganado",
            _ => "perfil-ganado"
        };
    }

    /// <summary>
    /// Guarda la foto de perfil de usuario en `public/imagenes/perfil-usuario/{userId}/...`
    /// devolviendo únicamente la ruta relativa para persistir en la BD.
    /// </summary>
    public Task<(bool Ok, string? RelativePath, string? Error)> SaveUserProfilePhotoAsync(
        Guid userId,
        IFormFile? file,
        CancellationToken ct) =>
        SaveImageInCategoryAsync(
            categoryFolder: "perfil-usuario",
            ownerFolder: userId.ToString("N"),
            filePrefix: "perfil",
            file: file,
            maxBytes: MaxProfilePhotoBytes,
            ct: ct);

    /// <summary>
    /// Guarda una imagen de ganado/pesaje/documento en `public/imagenes/{categoria}/{ownerId}/...`
    /// devolviendo únicamente la ruta relativa (`public/imagenes/...`) para persistir en la BD.
    /// </summary>
    public Task<(bool Ok, string? RelativePath, string? Error)> SaveCattleMediaAsync(
        string? tipo,
        Guid ownerId,
        IFormFile? file,
        CancellationToken ct)
    {
        var category = ResolveCategoryFolder(tipo);
        var prefix = category switch
        {
            "pesaje-ganado" => "pesaje",
            "documentos-ganado" => "doc",
            _ => "perfil"
        };
        return SaveImageInCategoryAsync(
            categoryFolder: category,
            ownerFolder: ownerId.ToString("N"),
            filePrefix: prefix,
            file: file,
            maxBytes: MaxMediaPhotoBytes,
            ct: ct);
    }

    private async Task<(bool Ok, string? RelativePath, string? Error)> SaveImageInCategoryAsync(
        string categoryFolder,
        string ownerFolder,
        string filePrefix,
        IFormFile? file,
        long maxBytes,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return (false, null, "Selecciona una imagen válida.");

        if (file.Length > maxBytes)
        {
            var maxMb = maxBytes / (1024 * 1024);
            return (false, null, $"La imagen excede el tamaño máximo permitido de {maxMb} MB.");
        }

        var mime = (file.ContentType ?? string.Empty).Trim().ToLowerInvariant();
        if (!AllowedMimeTypes.TryGetValue(mime, out var formatInfo))
            return (false, null, "Formato no permitido. Usa una imagen JPEG, PNG o WebP.");

        // Validar firma binaria (magic bytes) para evitar archivos disfrazados
        await using var stream = file.OpenReadStream();
        var header = new byte[12];
        var read = await stream.ReadAsync(header.AsMemory(0, header.Length), ct);
        if (!MatchesImageSignature(header, read, formatInfo.ContentType))
            return (false, null, "El archivo no corresponde a una imagen JPEG, PNG o WebP válida.");

        var targetDir = Path.Combine(_publicImagesRoot, categoryFolder, ownerFolder);
        Directory.CreateDirectory(targetDir);

        var fileName = $"{filePrefix}_{DateTime.UtcNow:yyyyMMddHHmmss}_{Guid.NewGuid().ToString("N")[..8]}{formatInfo.Extension}";
        var physicalPath = Path.GetFullPath(Path.Combine(targetDir, fileName));
        if (!IsInsideRoot(physicalPath, _publicImagesRoot))
            return (false, null, "Ruta de almacenamiento inválida.");

        if (stream.CanSeek)
            stream.Position = 0;

        await using (var target = new FileStream(physicalPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            if (stream.CanSeek)
            {
                await stream.CopyToAsync(target, ct);
            }
            else
            {
                await target.WriteAsync(header.AsMemory(0, read), ct);
                await stream.CopyToAsync(target, ct);
            }
        }

        var relativePath = $"public/imagenes/{categoryFolder}/{ownerFolder}/{fileName}";
        return (true, relativePath, null);
    }

    public void DeleteIfExists(string? storedPath)
    {
        var resolved = ResolvePhysicalFile(storedPath);
        if (resolved is null) return;

        try
        {
            if (File.Exists(resolved.Value.FullPath))
                File.Delete(resolved.Value.FullPath);

            // Limpiar subcarpeta del propietario si quedó vacía (sin tocar las carpetas de categoría ni la raíz)
            var ownerDir = Path.GetDirectoryName(resolved.Value.FullPath);
            if (!string.IsNullOrEmpty(ownerDir) && Directory.Exists(ownerDir))
            {
                var categoryDir = Path.GetDirectoryName(ownerDir);
                var isNestedOwnerFolder =
                    !string.IsNullOrEmpty(categoryDir) &&
                    (IsInsideRoot(ownerDir, _publicImagesRoot) || IsInsideRoot(ownerDir, _legacyUploadsRoot)) &&
                    !string.Equals(Path.GetFullPath(categoryDir), _contentRoot, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(Path.GetFullPath(ownerDir), _publicImagesRoot, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(Path.GetFullPath(ownerDir), _legacyUploadsRoot, StringComparison.OrdinalIgnoreCase);

                if (isNestedOwnerFolder && !Directory.EnumerateFileSystemEntries(ownerDir).Any())
                {
                    Directory.Delete(ownerDir);
                }
            }
        }
        catch (IOException)
        {
            // Ignorar si el archivo o directorio está temporalmente bloqueado
        }
    }

    /// <summary>
    /// Resuelve únicamente avatares públicos de perfil de usuario (<c>public/imagenes/perfil-usuario/...</c>
    /// y legado <c>uploads/usuarios/...</c>). Jamás expone fotografías privadas de ganado o ranchos.
    /// </summary>
    public (string FullPath, string ContentType)? ResolvePublicUserProfileFile(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
            return null;

        var normalized = relativePath.Trim().Replace('\\', '/').TrimStart('/');
        if (!normalized.StartsWith("public/imagenes/perfil-usuario/", StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("uploads/usuarios/", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return ResolvePhysicalFile(normalized);
    }

    public (string FullPath, string ContentType)? ResolvePhysicalFile(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
            return null;

        var normalized = relativePath.Trim().Replace('\\', '/').TrimStart('/');
        if (normalized.Contains("..", StringComparison.Ordinal))
            return null;

        string candidate;
        if (normalized.StartsWith("public/imagenes/", StringComparison.OrdinalIgnoreCase))
        {
            candidate = Path.GetFullPath(Path.Combine(_contentRoot, normalized));
            if (!IsInsideRoot(candidate, _publicImagesRoot) || !File.Exists(candidate))
                return null;
        }
        else if (normalized.StartsWith("uploads/", StringComparison.OrdinalIgnoreCase))
        {
            // Compatibilidad con imágenes previas guardadas en App_Data/uploads/...
            candidate = Path.GetFullPath(Path.Combine(_legacyAppDataRoot, normalized));
            if (!IsInsideRoot(candidate, _legacyUploadsRoot) || !File.Exists(candidate))
                return null;
        }
        else
        {
            return null;
        }

        var ext = Path.GetExtension(candidate);
        if (!ContentTypeByExtension.TryGetValue(ext, out var contentType))
            return null;

        return (candidate, contentType);
    }

    private static bool IsInsideRoot(string fullPath, string rootPath)
    {
        var rootWithSep = rootPath.EndsWith(Path.DirectorySeparatorChar)
            ? rootPath
            : rootPath + Path.DirectorySeparatorChar;
        return fullPath.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesImageSignature(byte[] header, int length, string contentType)
    {
        if (length < 4) return false;
        return contentType switch
        {
            "image/jpeg" => header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF,
            "image/png" => length >= 8 &&
                           header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47 &&
                           header[4] == 0x0D && header[5] == 0x0A && header[6] == 0x1A && header[7] == 0x0A,
            "image/webp" => length >= 12 &&
                            header[0] == (byte)'R' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'F' &&
                            header[8] == (byte)'W' && header[9] == (byte)'E' && header[10] == (byte)'B' && header[11] == (byte)'P',
            _ => false
        };
    }
}
