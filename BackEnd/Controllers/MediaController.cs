using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Controllers;

[ApiController]
[Route("api/media")]
public sealed class MediaController(
    FarmDbContext db,
    ProfilePhotoStorageService storage,
    RanchAccessService access) : ControllerBase
{
    private static readonly HashSet<string> AllowedTipos = new(StringComparer.OrdinalIgnoreCase)
    {
        "FotoPerfil",
        "BoviScaleVision",
        "Documento"
    };

    /// <summary>
    /// Lista archivos multimedia sincronizados de los ranchos donde el usuario tiene membresía activa.
    /// Devuelve tanto la ruta relativa almacenada en BD (`rutaArchivo`) como la URL lista para el Frontend (`urlPublica`).
    /// </summary>
    [HttpGet("archivos")]
    [Authorize]
    public async Task<ActionResult<List<ArchivoMultimediaDto>>> ListArchivos(
        [FromQuery] Guid? idAnimal = null,
        [FromQuery] bool incluirEliminados = false,
        CancellationToken ct = default)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var activeRanchIds = access.ActiveRanchIds(userId.Value);
        var query = db.ArchivosMultimedia.AsNoTracking()
            .Where(m => activeRanchIds.Contains(m.IdRancho));

        if (!incluirEliminados)
            query = query.Where(m => m.EliminadoEn == null);

        if (idAnimal.HasValue && idAnimal.Value != Guid.Empty)
            query = query.Where(m => m.IdAnimal == idAnimal.Value);

        var rows = await query
            .OrderByDescending(m => m.FechaCaptura)
            .ToListAsync(ct);

        return Ok(rows.Select(ToDto).ToList());
    }

    /// <summary>
    /// Sube y sincroniza una fotografía (perfil de bovino, pesaje BoviScale o documento).
    /// Guarda la imagen físicamente en `public/imagenes/{perfil-ganado|pesaje-ganado|documentos-ganado}/...`
    /// y persiste ÚNICAMENTE la ruta relativa en la tabla `ArchivoMultimedia`.
    /// </summary>
    [HttpPost("archivos")]
    [Authorize]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(ProfilePhotoStorageService.MaxMediaPhotoBytes + 512 * 1024)]
    public async Task<ActionResult<ArchivoMultimediaDto>> UploadArchivo(
        [FromForm] UploadArchivoMultimediaForm form,
        CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var mediaId = form.IdArchivo is { } providedId && providedId != Guid.Empty
            ? providedId
            : Guid.NewGuid();

        // Idempotencia: si ya fue sincronizado previamente con el mismo IdArchivo, validar acceso y devolverlo
        var existing = await db.ArchivosMultimedia.AsNoTracking()
            .FirstOrDefaultAsync(m => m.IdArchivo == mediaId, ct);
        if (existing is not null)
        {
            if (!await access.CanAccessAsync(userId.Value, existing.IdRancho, ct))
                return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "No tienes permisos sobre el rancho de este archivo." });

            return Ok(ToDto(existing));
        }

        Guid resolvedRanchId = form.IdRancho ?? Guid.Empty;
        Guid? resolvedAnimalId = form.IdAnimal is { } aId && aId != Guid.Empty ? aId : null;

        if (resolvedAnimalId.HasValue)
        {
            var animal = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == resolvedAnimalId.Value && a.EliminadoEn == null, ct);
            if (animal is null)
                return BadRequest(new { mensaje = "El bovino asociado no existe o aún no se ha sincronizado en el servidor." });

            resolvedRanchId = animal.IdRancho;
        }

        if (resolvedRanchId == Guid.Empty)
            return BadRequest(new { mensaje = "Debes indicar el animal o rancho al que pertenece la imagen." });

        if (!await access.CanAccessAsync(userId.Value, resolvedRanchId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                mensaje = "No tienes membresía activa en el rancho para subir imágenes."
            });
        }

        var tipoNormalizado = !string.IsNullOrWhiteSpace(form.Tipo) && AllowedTipos.Contains(form.Tipo.Trim())
            ? NormalizeTipo(form.Tipo)
            : "FotoPerfil";

        var ownerFolderId = resolvedAnimalId ?? resolvedRanchId;
        var saved = await storage.SaveCattleMediaAsync(tipoNormalizado, ownerFolderId, form.Archivo, ct);
        if (!saved.Ok || string.IsNullOrWhiteSpace(saved.RelativePath))
            return BadRequest(new { mensaje = saved.Error ?? "No se pudo guardar la imagen." });

        var now = DateTime.UtcNow;
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
            NombreArchivo = !string.IsNullOrWhiteSpace(form.NombreArchivo)
                ? form.NombreArchivo.Trim()
                : Path.GetFileName(saved.RelativePath),
            MimeType = string.IsNullOrWhiteSpace(form.Archivo?.ContentType)
                ? "image/jpeg"
                : form.Archivo!.ContentType.Trim().ToLowerInvariant(),
            TamanoBytes = form.Archivo?.Length ?? 0,
            ChecksumSha256 = string.IsNullOrWhiteSpace(form.ChecksumSha256)
                ? null
                : form.ChecksumSha256.Trim().ToLowerInvariant(),
            RutaArchivo = saved.RelativePath,
            FechaCaptura = form.FechaCaptura is { } fc && fc != default ? fc : now,
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
            storage.DeleteIfExists(saved.RelativePath);
            var concurrent = await db.ArchivosMultimedia.AsNoTracking()
                .FirstOrDefaultAsync(m => m.IdArchivo == mediaId, ct);
            if (concurrent is not null)
                return Ok(ToDto(concurrent));

            return Conflict(new { mensaje = "No se pudo registrar la ruta de la imagen en la base de datos." });
        }

        return StatusCode(StatusCodes.Status201Created, ToDto(entity));
    }

    /// <summary>
    /// Desactiva lógicamente el registro en BD y elimina el archivo físico del disco.
    /// </summary>
    [HttpDelete("archivos/{id:guid}")]
    [Authorize]
    public async Task<IActionResult> DeleteArchivo(Guid id, CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null) return Unauthorized();

        var item = await db.ArchivosMultimedia.FirstOrDefaultAsync(m => m.IdArchivo == id, ct);
        if (item is null) return NotFound();

        if (!await access.CanAccessAsync(userId.Value, item.IdRancho, ct))
            return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "No tienes permisos sobre el rancho de este archivo." });

        var rutaPrevia = item.RutaArchivo;
        if (item.EliminadoEn is null)
        {
            item.EliminadoEn = DateTime.UtcNow;
            item.VersionRegistro++;
            await db.SaveChangesAsync(ct);
        }

        storage.DeleteIfExists(rutaPrevia);
        return NoContent();
    }

    /// <summary>
    /// Sirve imágenes públicas almacenadas en disco por su ruta relativa guardada en BD
    /// (ej. `public/imagenes/perfil-ganado/...`, `public/imagenes/perfil-usuario/...`, `public/imagenes/pesaje-ganado/...`).
    /// </summary>
    [HttpGet("{**ruta}")]
    [AllowAnonymous]
    public IActionResult GetMediaFile(string ruta)
    {
        var resolved = storage.ResolvePhysicalFile(ruta);
        if (resolved is null)
            return NotFound(new { mensaje = "Archivo de imagen no encontrado." });

        Response.Headers.CacheControl = "public, max-age=86400";
        return PhysicalFile(resolved.Value.FullPath, resolved.Value.ContentType);
    }

    private ArchivoMultimediaDto ToDto(ArchivoMultimedia m) =>
        new(
            IdArchivo: m.IdArchivo,
            IdRancho: m.IdRancho,
            IdAnimal: m.IdAnimal,
            EntidadRelacionada: m.EntidadRelacionada,
            IdEntidadRelacionada: m.IdEntidadRelacionada,
            Tipo: m.Tipo,
            NombreArchivo: m.NombreArchivo,
            MimeType: m.MimeType,
            TamanoBytes: m.TamanoBytes,
            ChecksumSha256: m.ChecksumSha256,
            RutaArchivo: m.RutaArchivo,
            UrlPublica: storage.ToPublicUrl(m.RutaArchivo) ?? string.Empty,
            FechaCaptura: m.FechaCaptura,
            CreadoEn: m.CreadoEn,
            VersionRegistro: m.VersionRegistro,
            EliminadoEn: m.EliminadoEn);

    private static string NormalizeTipo(string raw) =>
        raw.Trim().ToLowerInvariant() switch
        {
            "boviscalevision" => "BoviScaleVision",
            "documento" => "Documento",
            _ => "FotoPerfil"
        };
}
