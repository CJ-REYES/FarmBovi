using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using FarmBovi.Api.Services.Storage;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/media")]
public sealed class MediaController(
    FarmDbContext db,
    IMediaStorageProvider mediaStorage,
    MediaFileValidationService fileValidator,
    ProfilePhotoStorageService profileStorage,
    RanchAccessService access) : ControllerBase
{
    private const long MultipartRequestCeilingBytes = 12 * 1024 * 1024; // 10 MB de archivo + margen multipart

    private static readonly HashSet<string> AllowedTipos = new(StringComparer.OrdinalIgnoreCase)
    {
        "FotoPerfil",
        "BoviScaleVision",
        "Documento"
    };

    /// <summary>
    /// Lista metadatos de archivos multimedia pertenecientes a los ranchos activos del usuario autenticado.
    /// </summary>
    [HttpGet("archivos")]
    [Authorize]
    [ProducesResponseType(typeof(List<ArchivoMultimediaDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<ArchivoMultimediaDto>>> ListArchivos(
        [FromQuery] Guid? idRancho = null,
        [FromQuery] Guid? idAnimal = null,
        [FromQuery] string? tipo = null,
        [FromQuery] string? estado = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return this.UnauthorizedProblem();

        if (idRancho is { } requestedRanchId)
        {
            if (requestedRanchId == Guid.Empty)
                return this.ValidationError("El identificador del rancho (idRancho) no es válido.", nameof(idRancho));

            if (!await access.CanAccessAsync(userId.Value, requestedRanchId, ct))
                return this.ForbiddenProblem("No tienes permisos sobre el rancho solicitado.");
        }

        if (idAnimal is { } requestedAnimalId)
        {
            if (requestedAnimalId == Guid.Empty)
                return this.ValidationError("El identificador del animal (idAnimal) no es válido.", nameof(idAnimal));

            var animalRanch = await access.RanchOfAnimalAsync(requestedAnimalId, ct);
            if (animalRanch is { } ownerRanch)
            {
                if (!await access.CanAccessAsync(userId.Value, ownerRanch, ct))
                    return this.ForbiddenProblem("No tienes permisos sobre el rancho de este animal.");

                if (idRancho.HasValue && idRancho.Value != ownerRanch)
                    return this.ValidationError("El animal indicado no pertenece al rancho solicitado.", nameof(idAnimal));
            }
        }

        string? normalizedTipo = null;
        if (!string.IsNullOrWhiteSpace(tipo))
        {
            if (!AllowedTipos.Contains(tipo.Trim()))
                return this.ValidationError("Tipo multimedia no válido. Valores permitidos: FotoPerfil, BoviScaleVision, Documento.", nameof(tipo));
            normalizedTipo = NormalizeTipo(tipo);
        }

        string? normalizedEstado = null;
        if (!string.IsNullOrWhiteSpace(estado))
        {
            normalizedEstado = EstadosArchivoMultimedia.Normalize(estado);
            if (normalizedEstado is null)
                return this.ValidationError("Estado de archivo no válido. Valores permitidos: Pendiente, Disponible, Eliminado, Error.", nameof(estado));
        }

        var activeRanchIds = access.ActiveRanchIds(userId.Value);
        var query = db.ArchivosMultimedia.AsNoTracking()
            .Where(m => activeRanchIds.Contains(m.IdRancho));

        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null && m.Estado != EstadosArchivoMultimedia.Eliminado);

        if (idRancho is { } filterRanch && filterRanch != Guid.Empty)
            query = query.Where(m => m.IdRancho == filterRanch);

        if (idAnimal is { } filterAnimal && filterAnimal != Guid.Empty)
            query = query.Where(m => m.IdAnimal == filterAnimal);

        if (normalizedTipo is not null)
            query = query.Where(m => m.Tipo == normalizedTipo);

        if (normalizedEstado is not null)
            query = query.Where(m => m.Estado == normalizedEstado);

        var rows = await query
            .OrderByDescending(m => m.FechaCaptura)
            .ThenByDescending(m => m.FechaCarga)
            .ToListAsync(ct);

        return Ok(rows.Select(ToDto).ToList());
    }

    /// <summary>
    /// Consulta los metadatos de un archivo multimedia específico verificando pertenencia al rancho.
    /// </summary>
    [HttpGet("archivos/{id:guid}")]
    [Authorize]
    [ProducesResponseType(typeof(ArchivoMultimediaDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ArchivoMultimediaDto>> GetArchivo(Guid id, CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return this.UnauthorizedProblem();

        var item = await db.ArchivosMultimedia.AsNoTracking()
            .FirstOrDefaultAsync(m => m.IdArchivo == id, ct);
        if (item is null)
            return this.NotFoundProblem("El archivo multimedia solicitado no existe.");

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return this.ForbiddenProblem("No tienes permisos sobre el rancho de este archivo.");

        return Ok(ToDto(item));
    }

    /// <summary>
    /// Descarga/transmite de forma autorizada el contenido binario de una fotografía privada de animal/rancho.
    /// Exige JWT válido (header Bearer o cookie HttpOnly) y membresía activa en el rancho propietario.
    /// </summary>
    [HttpGet("archivos/{id:guid}/contenido")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetArchivoContenido(Guid id, CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return this.UnauthorizedProblem();

        var item = await db.ArchivosMultimedia.AsNoTracking()
            .FirstOrDefaultAsync(m => m.IdArchivo == id, ct);
        if (item is null)
            return this.NotFoundProblem("El archivo multimedia solicitado no existe.");

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return this.ForbiddenProblem("No tienes permisos sobre el rancho de este archivo.");

        if (item.EliminadoEn is not null ||
            !string.Equals(item.Estado, EstadosArchivoMultimedia.Disponible, StringComparison.OrdinalIgnoreCase))
        {
            return this.NotFoundProblem("El archivo multimedia ya no está disponible.");
        }

        var media = await mediaStorage.OpenReadAsync(item.RutaArchivo, item.MimeType, ct);
        if (media is null)
            return this.NotFoundProblem("El objeto binario del archivo no fue encontrado en el almacenamiento.");

        Response.Headers.CacheControl = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentDisposition = $"inline; filename=\"{SanitizeHeaderFileName(item.NombreArchivo, item.Extension)}\"";

        return File(media.Content, media.ContentType, enableRangeProcessing: true);
    }

    /// <summary>
    /// Carga y almacena una fotografía asociada a un animal y rancho de forma segura.
    /// Persiste el binario únicamente a través de <see cref="IMediaStorageProvider"/> (fuera de BD y fuera de rutas públicas)
    /// y registra los metadatos en <c>ArchivoMultimedia</c>.
    /// </summary>
    [HttpPost("archivos")]
    [Authorize]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MultipartRequestCeilingBytes)]
    [ProducesResponseType(typeof(ArchivoMultimediaDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ArchivoMultimediaDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status413PayloadTooLarge)]
    public async Task<ActionResult<ArchivoMultimediaDto>> UploadArchivo(
        [FromForm] UploadArchivoMultimediaForm form,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return this.UnauthorizedProblem();

        if (form.IdArchivo is { } rawMediaId && rawMediaId == Guid.Empty)
            return this.ValidationError("El identificador del archivo (idArchivo) no es válido.", nameof(form.IdArchivo));
        if (form.IdRancho is { } rawRanchoId && rawRanchoId == Guid.Empty)
            return this.ValidationError("El identificador del rancho (idRancho) no es válido.", nameof(form.IdRancho));
        if (form.IdAnimal is { } rawAnimalId && rawAnimalId == Guid.Empty)
            return this.ValidationError("El identificador del animal (idAnimal) no es válido.", nameof(form.IdAnimal));

        var mediaId = form.IdArchivo ?? Guid.NewGuid();

        // Idempotencia sin sobrescritura accidental
        var existing = await db.ArchivosMultimedia.AsNoTracking()
            .FirstOrDefaultAsync(m => m.IdArchivo == mediaId, ct);
        if (existing is not null)
        {
            if (!await access.CanAccessAsync(userId.Value, existing.IdRancho, ct))
                return this.ForbiddenProblem("No tienes permisos sobre el rancho de este archivo.");

            if (existing.EliminadoEn is not null ||
                string.Equals(existing.Estado, EstadosArchivoMultimedia.Eliminado, StringComparison.OrdinalIgnoreCase))
            {
                return this.ConflictProblem("El identificador de archivo ya fue utilizado por un registro eliminado.");
            }

            if ((form.IdAnimal.HasValue && existing.IdAnimal != form.IdAnimal.Value) ||
                (form.IdRancho.HasValue && existing.IdRancho != form.IdRancho.Value))
            {
                return this.ConflictProblem("Ya existe un archivo con el mismo identificador asociado a otro animal o rancho.");
            }

            return Ok(ToDto(existing));
        }

        // Validación estricta de pertenencia de Animal y Rancho
        Guid resolvedRanchId = form.IdRancho ?? Guid.Empty;
        Guid? resolvedAnimalId = form.IdAnimal;

        if (resolvedAnimalId.HasValue)
        {
            var animal = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == resolvedAnimalId.Value && a.EliminadoEn == null, ct);
            if (animal is null)
                return this.ValidationError("El bovino asociado no existe o está eliminado.", nameof(form.IdAnimal));

            if (!await access.CanAccessAsync(userId.Value, animal.IdRancho, ct))
                return this.ForbiddenProblem("No tienes membresía activa en el rancho del bovino seleccionado.");

            if (form.IdRancho.HasValue && form.IdRancho.Value != animal.IdRancho)
            {
                if (!await access.CanAccessAsync(userId.Value, form.IdRancho.Value, ct))
                    return this.ForbiddenProblem("No tienes membresía activa en el rancho especificado.");

                return this.ValidationError(
                    "El bovino especificado no pertenece al rancho indicado.",
                    nameof(form.IdAnimal));
            }

            resolvedRanchId = animal.IdRancho;
        }
        else
        {
            if (resolvedRanchId == Guid.Empty)
                return this.ValidationError("Debes indicar el animal o rancho al que pertenece la fotografía.", nameof(form.IdAnimal));

            if (!await access.CanAccessAsync(userId.Value, resolvedRanchId, ct))
                return this.ForbiddenProblem("No tienes membresía activa en el rancho para subir fotografías.");
        }

        string tipoNormalizado;
        if (string.IsNullOrWhiteSpace(form.Tipo))
        {
            tipoNormalizado = "FotoPerfil";
        }
        else if (AllowedTipos.Contains(form.Tipo.Trim()))
        {
            tipoNormalizado = NormalizeTipo(form.Tipo);
        }
        else
        {
            return this.ValidationError(
                "Tipo multimedia no válido. Valores permitidos: FotoPerfil, BoviScaleVision, Documento.",
                nameof(form.Tipo));
        }

        // Validación de seguridad de archivo (tamaño, MIME real, extensión, ejecutables, path traversal)
        var validation = await fileValidator.ValidateAsync(form.Archivo, form.NombreArchivo, ct);
        if (!validation.IsValid)
        {
            if (validation.IsTooLarge)
            {
                return Problem(
                    statusCode: StatusCodes.Status413PayloadTooLarge,
                    title: "Archivo demasiado grande.",
                    detail: validation.Error);
            }

            return this.ValidationError(validation.Error ?? "El archivo fotográfico no es válido.", nameof(form.Archivo));
        }

        // Almacenamiento físico desacoplado mediante IMediaStorageProvider
        var category = LocalFileMediaStorageProvider.ResolveCategory(tipoNormalizado);
        MediaStoreResult stored;
        await using (var uploadStream = form.Archivo!.OpenReadStream())
        {
            stored = await mediaStorage.SaveAsync(
                new MediaStoreRequest(
                    IdArchivo: mediaId,
                    IdRancho: resolvedRanchId,
                    IdAnimal: resolvedAnimalId,
                    Categoria: category,
                    CanonicalExtension: validation.CanonicalExtension!,
                    RealMimeType: validation.RealMimeType!,
                    MaxAllowedBytes: fileValidator.MaxFileSizeBytes,
                    ContentStream: uploadStream),
                ct);
        }

        if (!stored.Ok || string.IsNullOrWhiteSpace(stored.StorageLocation))
        {
            if (stored.IsTooLarge)
            {
                return Problem(
                    statusCode: StatusCodes.Status413PayloadTooLarge,
                    title: "Archivo demasiado grande.",
                    detail: stored.Error);
            }

            return this.ValidationError(stored.Error ?? "No se pudo almacenar la fotografía.", nameof(form.Archivo));
        }

        // Verificar integridad SHA-256 si el cliente envió un checksum declarado
        if (!string.IsNullOrWhiteSpace(form.ChecksumSha256))
        {
            var clientSha = form.ChecksumSha256.Trim().ToLowerInvariant();
            if (!string.Equals(clientSha, stored.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                await mediaStorage.DeleteAsync(stored.StorageLocation, ct);
                return this.ValidationError(
                    "El checksum SHA-256 proporcionado no coincide con el contenido real del archivo.",
                    nameof(form.ChecksumSha256));
            }
        }

        var now = DateTime.UtcNow;
        var fechaCapturaUtc = form.FechaCaptura is { } fc && fc != default
            ? ApiProblemResults.EnsureUtc(fc)
            : now;

        var entity = new ArchivoMultimedia
        {
            IdArchivo = mediaId,
            IdRancho = resolvedRanchId,
            IdAnimal = resolvedAnimalId,
            EntidadRelacionada = string.IsNullOrWhiteSpace(form.EntidadRelacionada)
                ? "cattle"
                : form.EntidadRelacionada.Trim(),
            IdEntidadRelacionada = form.IdEntidadRelacionada is { } relId && relId != Guid.Empty
                ? relId
                : resolvedAnimalId,
            Tipo = tipoNormalizado,
            NombreArchivo = validation.SanitizedDisplayFileName!,
            MimeType = validation.RealMimeType!,
            Extension = validation.CanonicalExtension!,
            TamanoBytes = stored.BytesWritten,
            ChecksumSha256 = stored.Sha256,
            ProveedorAlmacenamiento = stored.ProviderName,
            RutaArchivo = stored.StorageLocation,
            Estado = EstadosArchivoMultimedia.Disponible,
            FechaCaptura = fechaCapturaUtc,
            FechaCarga = now,
            IdAutor = userId.Value,
            CreadoEn = now,
            VersionRegistro = 1,
            EliminadoEn = null
        };

        db.ArchivosMultimedia.Add(entity);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Compensación: evitar archivos huérfanos en el almacenamiento físico
            await mediaStorage.DeleteAsync(stored.StorageLocation, ct);

            var concurrent = await db.ArchivosMultimedia.AsNoTracking()
                .FirstOrDefaultAsync(m => m.IdArchivo == mediaId, ct);
            if (concurrent is not null)
            {
                if (!await access.CanAccessAsync(userId.Value, concurrent.IdRancho, ct))
                    return this.ForbiddenProblem("No tienes permisos sobre el rancho de este archivo.");

                return concurrent.EliminadoEn is null &&
                       concurrent.IdRancho == resolvedRanchId &&
                       concurrent.IdAnimal == resolvedAnimalId
                    ? Ok(ToDto(concurrent))
                    : this.ConflictProblem("Conflicto de identificador con un archivo existente.");
            }

            return this.ConflictProblem("No se pudieron registrar los metadatos de la fotografía en la base de datos.");
        }

        return CreatedAtAction(nameof(GetArchivo), new { id = entity.IdArchivo }, ToDto(entity));
    }

    /// <summary>
    /// Eliminación autorizada: marca el registro en estado Eliminado (soft-delete con auditoría)
    /// y elimina el objeto binario del proveedor físico de almacenamiento.
    /// </summary>
    [HttpDelete("archivos/{id:guid}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteArchivo(Guid id, CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return this.UnauthorizedProblem();

        var item = await db.ArchivosMultimedia.FirstOrDefaultAsync(m => m.IdArchivo == id, ct);
        if (item is null)
            return this.NotFoundProblem("El archivo multimedia solicitado no existe.");

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return this.ForbiddenProblem("No tienes permisos sobre el rancho de este archivo.");

        var storageLocation = item.RutaArchivo;
        if (item.EliminadoEn is null ||
            !string.Equals(item.Estado, EstadosArchivoMultimedia.Eliminado, StringComparison.OrdinalIgnoreCase))
        {
            item.EliminadoEn ??= DateTime.UtcNow;
            item.Estado = EstadosArchivoMultimedia.Eliminado;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        await mediaStorage.DeleteAsync(storageLocation, ct);
        return NoContent();
    }

    /// <summary>
    /// Sirve ÚNICAMENTE avatares públicos de perfil de usuario (<c>public/imagenes/perfil-usuario/...</c>
    /// y legado <c>uploads/usuarios/...</c>). Las fotografías privadas de animales y ranchos jamás se exponen aquí;
    /// deben consultarse mediante <c>GET /api/media/archivos/{id}/contenido</c> con autorización.
    /// </summary>
    [HttpGet("{**ruta}")]
    [AllowAnonymous]
    public IActionResult GetMediaFile(string ruta)
    {
        var resolved = profileStorage.ResolvePublicUserProfileFile(ruta);
        if (resolved is null)
            return NotFound(new { mensaje = "Archivo de imagen no encontrado." });

        Response.Headers.CacheControl = "public, max-age=86400";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return PhysicalFile(resolved.Value.FullPath, resolved.Value.ContentType);
    }

    private static ArchivoMultimediaDto ToDto(ArchivoMultimedia m)
    {
        var contentUrl = $"/api/media/archivos/{m.IdArchivo}/contenido";
        return new ArchivoMultimediaDto(
            IdArchivo: m.IdArchivo,
            IdRancho: m.IdRancho,
            IdAnimal: m.IdAnimal,
            EntidadRelacionada: m.EntidadRelacionada,
            IdEntidadRelacionada: m.IdEntidadRelacionada,
            Tipo: m.Tipo,
            NombreArchivo: m.NombreArchivo,
            MimeType: m.MimeType,
            Extension: m.Extension,
            TamanoBytes: m.TamanoBytes,
            ChecksumSha256: m.ChecksumSha256,
            ProveedorAlmacenamiento: m.ProveedorAlmacenamiento,
            RutaArchivo: m.RutaArchivo,
            Estado: m.Estado,
            UrlContenido: contentUrl,
            UrlPublica: contentUrl,
            FechaCaptura: m.FechaCaptura,
            FechaCarga: m.FechaCarga,
            CreadoEn: m.CreadoEn,
            VersionRegistro: m.VersionRegistro,
            EliminadoEn: m.EliminadoEn);
    }

    private static string NormalizeTipo(string raw) =>
        raw.Trim().ToLowerInvariant() switch
        {
            "boviscalevision" => "BoviScaleVision",
            "documento" => "Documento",
            _ => "FotoPerfil"
        };

    private static string SanitizeHeaderFileName(string? name, string fallbackExtension)
    {
        var raw = string.IsNullOrWhiteSpace(name) ? $"foto{fallbackExtension}" : name;
        var chars = new List<char>(Math.Min(raw.Length, 120));
        foreach (var ch in raw)
        {
            if (char.IsAsciiLetterOrDigit(ch) || ch is '.' or '_' or '-')
                chars.Add(ch);
            else if (ch == ' ')
                chars.Add('_');
            if (chars.Count >= 120) break;
        }
        return chars.Count > 0 ? new string(chars.ToArray()) : $"foto{fallbackExtension}";
    }
}
