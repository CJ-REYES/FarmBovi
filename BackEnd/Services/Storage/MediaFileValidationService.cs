using Microsoft.Extensions.Options;

namespace FarmBovi.Api.Services.Storage;

public sealed record ValidatedMediaFile(
    bool IsValid,
    string? RealMimeType,
    string? CanonicalExtension,
    string? SanitizedDisplayFileName,
    long DeclaredLength,
    string? Error = null,
    bool IsTooLarge = false);

/// <summary>
/// Validador de seguridad para fotografías cargadas al sistema.
/// Verifica tamaño, firmas binarias reales (magic bytes), coincidencia entre MIME real,
/// MIME declarado y extensión, bloquea archivos ejecutables/scripts y rechaza path traversal.
/// </summary>
public sealed class MediaFileValidationService(IOptions<MediaStorageOptions> optionsAccessor)
{
    public const long DefaultMaxMediaBytes = 10 * 1024 * 1024;

    private static readonly Dictionary<string, (string RealMime, string CanonicalExtension, string[] AllowedExtensions)> AllowedByMime =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["image/jpeg"] = ("image/jpeg", ".jpg", [".jpg", ".jpeg"]),
            ["image/jpg"] = ("image/jpeg", ".jpg", [".jpg", ".jpeg"]),
            ["image/png"] = ("image/png", ".png", [".png"]),
            ["image/webp"] = ("image/webp", ".webp", [".webp"])
        };

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp"
    };

    /// <summary>
    /// Extensiones peligrosas (ejecutables, scripts, documentos activos) bloqueadas tanto como
    /// extensión final como en ataques de doble extensión (ej. <c>payload.exe.jpg</c>, <c>shell.php.png</c>).
    /// </summary>
    private static readonly HashSet<string> DangerousExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "exe", "dll", "bat", "cmd", "sh", "bash", "zsh", "ps1", "psm1", "msi", "msp", "com",
        "scr", "pif", "vbs", "vbe", "js", "jse", "mjs", "cjs", "wsf", "wsh", "hta", "cpl",
        "php", "phtml", "phar", "jsp", "jspx", "asp", "aspx", "ashx", "asmx", "cgi", "pl",
        "py", "pyc", "rb", "jar", "war", "ear", "class", "elf", "so", "dylib", "bin", "run",
        "app", "dmg", "pkg", "deb", "rpm", "apk", "svg", "svgz", "html", "htm", "xhtml", "xml",
        "xsl", "xslt", "htaccess", "config", "ini", "reg", "lnk"
    };

    public long MaxFileSizeBytes =>
        optionsAccessor.Value.MaxFileSizeBytes > 0
            ? optionsAccessor.Value.MaxFileSizeBytes
            : DefaultMaxMediaBytes;

    public async Task<ValidatedMediaFile> ValidateAsync(
        IFormFile? file,
        string? requestedDisplayName,
        CancellationToken ct = default)
    {
        if (file is null || file.Length <= 0)
            return Fail("Selecciona una imagen válida y no vacía.");

        var maxBytes = MaxFileSizeBytes;
        if (file.Length > maxBytes)
        {
            var maxMb = Math.Round(maxBytes / (1024d * 1024d), 2);
            return Fail(
                $"El archivo excede el tamaño máximo permitido de {maxMb:0.##} MB.",
                isTooLarge: true);
        }

        // 1. Validar nombres proporcionados contra path traversal y caracteres peligrosos
        var rawFileName = (file.FileName ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(rawFileName))
            return Fail("El archivo debe incluir un nombre con extensión válida (.jpg, .jpeg, .png o .webp).");

        if (ContainsPathTraversalOrSeparators(rawFileName))
            return Fail("El nombre del archivo contiene secuencias de ruta o caracteres no permitidos.");

        if (!string.IsNullOrWhiteSpace(requestedDisplayName) &&
            ContainsPathTraversalOrSeparators(requestedDisplayName.Trim()))
        {
            return Fail("El nombre de archivo especificado contiene secuencias de ruta o caracteres no permitidos.");
        }

        // 2. Validar extensión y bloquear ejecutables / dobles extensiones peligrosas
        var extensionError = ValidateExtensionSecurity(rawFileName, out var fileExtension);
        if (extensionError is not null)
            return Fail(extensionError);

        if (!string.IsNullOrWhiteSpace(requestedDisplayName))
        {
            var displayTrimmed = requestedDisplayName.Trim();
            if (HasDangerousSegment(displayTrimmed))
                return Fail("El nombre de archivo contiene una extensión peligrosa o ejecutable no permitida.");
        }

        // 3. Inspeccionar firma binaria real (magic bytes) del contenido
        var header = new byte[32];
        int bytesRead;
        await using (var probeStream = file.OpenReadStream())
        {
            bytesRead = await ReadUpToAsync(probeStream, header, ct);
        }

        if (bytesRead < 4)
            return Fail("El archivo es demasiado pequeño o está corrupto para ser una imagen válida.");

        if (IsExecutableOrScriptSignature(header, bytesRead))
            return Fail("No se permite almacenar archivos ejecutables, scripts o documentos activos.");

        var detectedMime = DetectRealImageMime(header, bytesRead);
        if (detectedMime is null)
            return Fail("El contenido binario real del archivo no corresponde a una imagen JPEG, PNG o WebP válida.");

        // 4. Validar MIME declarado (Content-Type) y coincidencia exacta con MIME real
        var declaredMime = NormalizeDeclaredMime(file.ContentType);
        if (string.IsNullOrWhiteSpace(declaredMime) || !AllowedByMime.TryGetValue(declaredMime, out var declaredInfo))
            return Fail("Tipo MIME no permitido. Usa una imagen JPEG, PNG o WebP.");

        if (!string.Equals(declaredInfo.RealMime, detectedMime, StringComparison.OrdinalIgnoreCase))
        {
            return Fail(
                $"El tipo MIME declarado ('{declaredInfo.RealMime}') no coincide con el contenido real del archivo ('{detectedMime}').");
        }

        // 5. Validar que la extensión del archivo coincida con el MIME real detectado
        var realInfo = AllowedByMime[detectedMime];
        if (!realInfo.AllowedExtensions.Contains(fileExtension, StringComparer.OrdinalIgnoreCase))
        {
            return Fail(
                $"La extensión '{fileExtension}' no coincide con el tipo real de la imagen ('{detectedMime}').");
        }

        // 6. Construir nombre descriptivo sanitizado (solo metadato; jamás se usa como ruta física)
        var sanitizedDisplay = SanitizeDisplayFileName(
            !string.IsNullOrWhiteSpace(requestedDisplayName) ? requestedDisplayName! : rawFileName,
            realInfo.CanonicalExtension);

        return new ValidatedMediaFile(
            IsValid: true,
            RealMimeType: realInfo.RealMime,
            CanonicalExtension: realInfo.CanonicalExtension,
            SanitizedDisplayFileName: sanitizedDisplay,
            DeclaredLength: file.Length);
    }

    public static bool ContainsPathTraversalOrSeparators(string value)
    {
        if (value.Contains("..", StringComparison.Ordinal)) return true;
        if (value.IndexOfAny(['/', '\\', '\0', ':']) >= 0) return true;
        foreach (var ch in value)
        {
            if (char.IsControl(ch)) return true;
        }
        return false;
    }

    private static string? ValidateExtensionSecurity(string fileName, out string normalizedExtension)
    {
        normalizedExtension = string.Empty;

        var ext = Path.GetExtension(fileName);
        if (string.IsNullOrWhiteSpace(ext))
            return "El archivo debe incluir una extensión de imagen permitida (.jpg, .jpeg, .png o .webp).";

        var extWithoutDot = ext.TrimStart('.');
        if (DangerousExtensions.Contains(extWithoutDot))
            return $"No se permite cargar archivos con extensión ejecutable o peligrosa ('{ext}').";

        if (!AllowedExtensions.Contains(ext))
            return $"Extensión '{ext}' no permitida. Solo se aceptan imágenes .jpg, .jpeg, .png o .webp.";

        if (HasDangerousSegment(fileName))
            return "Se detectó una doble extensión ejecutable o peligrosa no permitida en el nombre del archivo.";

        normalizedExtension = ext.ToLowerInvariant();
        return null;
    }

    private static bool HasDangerousSegment(string fileName)
    {
        var segments = fileName.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length <= 1) return false;

        // Evaluar todos los segmentos posteriores al nombre base (ej. "shell.php.jpg" -> "php", "jpg")
        for (var i = 1; i < segments.Length; i++)
        {
            if (DangerousExtensions.Contains(segments[i]))
                return true;
        }

        return false;
    }

    private static string? NormalizeDeclaredMime(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType)) return null;
        var semi = contentType.IndexOf(';');
        var bare = semi >= 0 ? contentType[..semi] : contentType;
        return bare.Trim().ToLowerInvariant();
    }

    private static async Task<int> ReadUpToAsync(Stream stream, byte[] buffer, CancellationToken ct)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(total, buffer.Length - total), ct);
            if (n == 0) break;
            total += n;
        }
        return total;
    }

    internal static bool IsExecutableOrScriptSignature(ReadOnlySpan<byte> header, int length)
    {
        if (length < 2) return false;

        // Windows PE / DOS MZ executable (.exe, .dll, .scr)
        if (header[0] == (byte)'M' && header[1] == (byte)'Z')
            return true;

        // Shebang script (#!)
        if (header[0] == (byte)'#' && header[1] == (byte)'!')
            return true;

        if (length >= 4)
        {
            // Linux ELF binary (\x7FELF)
            if (header[0] == 0x7F && header[1] == (byte)'E' && header[2] == (byte)'L' && header[3] == (byte)'F')
                return true;

            // Mach-O / Java class / Universal binary
            if ((header[0] == 0xFE && header[1] == 0xED && header[2] == 0xFA && (header[3] == 0xCE || header[3] == 0xCF)) ||
                (header[0] == 0xCE && header[1] == 0xFA && header[2] == 0xED && header[3] == 0xFE) ||
                (header[0] == 0xCF && header[1] == 0xFA && header[2] == 0xED && header[3] == 0xFE) ||
                (header[0] == 0xCA && header[1] == 0xFE && header[2] == 0xBA && header[3] == 0xBE))
                return true;

            // ZIP / JAR / APK / Office container (PK\x03\x04)
            if (header[0] == 0x50 && header[1] == 0x4B && header[2] == 0x03 && header[3] == 0x04)
                return true;

            // PDF (%PDF)
            if (header[0] == (byte)'%' && header[1] == (byte)'P' && header[2] == (byte)'D' && header[3] == (byte)'F')
                return true;
        }

        // Markup / scripts activos (SVG, HTML, XML, PHP) incluso tras espacios o UTF-8 BOM
        var offset = 0;
        if (length >= 3 && header[0] == 0xEF && header[1] == 0xBB && header[2] == 0xBF)
            offset = 3;
        while (offset < length && (header[offset] == (byte)' ' || header[offset] == (byte)'\t' ||
                                   header[offset] == (byte)'\r' || header[offset] == (byte)'\n'))
        {
            offset++;
        }

        if (offset < length && header[offset] == (byte)'<')
            return true;

        return false;
    }

    internal static string? DetectRealImageMime(ReadOnlySpan<byte> header, int length)
    {
        // JPEG: FF D8 FF
        if (length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF)
            return "image/jpeg";

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (length >= 8 &&
            header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47 &&
            header[4] == 0x0D && header[5] == 0x0A && header[6] == 0x1A && header[7] == 0x0A)
        {
            return "image/png";
        }

        // WebP: RIFF <4 bytes size> WEBP + chunk (VP8 , VP8L, VP8X)
        if (length >= 16 &&
            header[0] == (byte)'R' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'F' &&
            header[8] == (byte)'W' && header[9] == (byte)'E' && header[10] == (byte)'B' && header[11] == (byte)'P' &&
            header[12] == (byte)'V' && header[13] == (byte)'P' && header[14] == (byte)'8' &&
            (header[15] == (byte)' ' || header[15] == (byte)'L' || header[15] == (byte)'X'))
        {
            return "image/webp";
        }

        return null;
    }

    private static string SanitizeDisplayFileName(string rawName, string canonicalExtension)
    {
        var baseName = Path.GetFileNameWithoutExtension(rawName.Trim());
        var safeChars = new List<char>(Math.Min(baseName.Length, 180));
        foreach (var ch in baseName)
        {
            if (char.IsLetterOrDigit(ch) || ch is '-' or '_' or ' ' or '.')
                safeChars.Add(ch);
            if (safeChars.Count >= 180)
                break;
        }

        var cleanedBase = new string(safeChars.ToArray()).Trim(' ', '.');
        if (string.IsNullOrWhiteSpace(cleanedBase))
            cleanedBase = "fotografia";

        return cleanedBase + canonicalExtension;
    }

    private static ValidatedMediaFile Fail(string error, bool isTooLarge = false) =>
        new(false, null, null, null, 0, error, isTooLarge);
}
