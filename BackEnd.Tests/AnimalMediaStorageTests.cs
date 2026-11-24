using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services.Storage;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FarmBovi.Tests;

public sealed class AnimalMediaStorageTests : IAsyncLifetime
{
    private static readonly PasswordHasher<Usuario> Hasher = new();

    // PNG válido 1x1 (67 bytes)
    private static readonly byte[] ValidPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    // JPEG mínimo válido con firma FF D8 FF E0 (JFIF) y EOI FF D9
    private static readonly byte[] ValidJpegBytes =
    [
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
    ];

    // WebP mínimo válido con firma RIFF....WEBPVP8L
    private static readonly byte[] ValidWebpBytes =
    [
        (byte)'R', (byte)'I', (byte)'F', (byte)'F', 0x1A, 0x00, 0x00, 0x00,
        (byte)'W', (byte)'E', (byte)'B', (byte)'P', (byte)'V', (byte)'P', (byte)'8', (byte)'L',
        0x0D, 0x00, 0x00, 0x00, 0x2F, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xFE, 0x07, 0x00
    ];

    private readonly FarmBoviApiFactory _factory = new();
    private readonly Guid _userA = Guid.NewGuid();
    private readonly Guid _userB = Guid.NewGuid();
    private readonly Guid _userMultiRanch = Guid.NewGuid();
    private readonly Guid _userInactive = Guid.NewGuid();
    private readonly Guid _ranchA = Guid.NewGuid();
    private readonly Guid _ranchB = Guid.NewGuid();
    private readonly Guid _animalA1 = Guid.NewGuid();
    private readonly Guid _animalA2 = Guid.NewGuid();
    private readonly Guid _animalB1 = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _factory.SeedAsync(db =>
        {
            var uA = NewUser(_userA, "Ganadero A", "ganadero.a@farmbovi.test", "Activo");
            var uB = NewUser(_userB, "Ganadero B", "ganadero.b@farmbovi.test", "Activo");
            var uMulti = NewUser(_userMultiRanch, "Multi Rancho", "multi@farmbovi.test", "Activo");
            var uInact = NewUser(_userInactive, "Inactivo", "inactivo@farmbovi.test", "Inactivo");
            db.Usuarios.AddRange(uA, uB, uMulti, uInact);

            db.Ranchos.AddRange(
                new Rancho { IdRancho = _ranchA, Nombre = "Rancho Norte", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = _userA },
                new Rancho { IdRancho = _ranchB, Nombre = "Rancho Sur", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = _userB });

            db.UsuarioRanchos.AddRange(
                new UsuarioRancho { IdUsuario = _userA, IdRancho = _ranchA, Rol = "Administrador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userB, IdRancho = _ranchB, Rol = "Administrador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userMultiRanch, IdRancho = _ranchA, Rol = "Operador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userMultiRanch, IdRancho = _ranchB, Rol = "Operador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userInactive, IdRancho = _ranchA, Rol = "Operador", Estado = "Activo" });

            db.Animales.AddRange(
                new Animal
                {
                    IdAnimal = _animalA1,
                    IdRancho = _ranchA,
                    Arete = "NORTE-001",
                    Raza = "Holstein",
                    Sexo = "Hembra",
                    FechaIngreso = new DateTime(2026, 1, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userA
                },
                new Animal
                {
                    IdAnimal = _animalA2,
                    IdRancho = _ranchA,
                    Arete = "NORTE-002",
                    Raza = "Angus",
                    Sexo = "Macho",
                    FechaIngreso = new DateTime(2026, 2, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Compra",
                    Estado = "Activo",
                    IdAutor = _userA
                },
                new Animal
                {
                    IdAnimal = _animalB1,
                    IdRancho = _ranchB,
                    Arete = "SUR-001",
                    Raza = "Brahman",
                    Sexo = "Hembra",
                    FechaIngreso = new DateTime(2026, 3, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userB
                });

            return Task.CompletedTask;
        });
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private HttpClient Client(Guid? userId = null)
    {
        var client = _factory.CreateClient();
        if (userId is { } id)
        {
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(id));
        }
        return client;
    }

    private static Usuario NewUser(Guid id, string nombre, string correo, string estado)
    {
        var u = new Usuario { IdUsuario = id, Nombre = nombre, Correo = correo, Estado = estado };
        u.Contrasena = Hasher.HashPassword(u, "ClaveSegura123!");
        return u;
    }

    private static MultipartFormDataContent BuildUploadForm(
        byte[] bytes,
        string fileName,
        string contentType,
        Guid? idAnimal = null,
        Guid? idRancho = null,
        Guid? idArchivo = null,
        string? tipo = "FotoPerfil",
        string? nombreArchivo = null,
        string? checksumSha256 = null,
        DateTime? fechaCaptura = null)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(fileContent, "archivo", fileName);

        if (idArchivo.HasValue) form.Add(new StringContent(idArchivo.Value.ToString()), "idArchivo");
        if (idAnimal.HasValue) form.Add(new StringContent(idAnimal.Value.ToString()), "idAnimal");
        if (idRancho.HasValue) form.Add(new StringContent(idRancho.Value.ToString()), "idRancho");
        if (tipo is not null) form.Add(new StringContent(tipo), "tipo");
        if (nombreArchivo is not null) form.Add(new StringContent(nombreArchivo), "nombreArchivo");
        if (checksumSha256 is not null) form.Add(new StringContent(checksumSha256), "checksumSha256");
        if (fechaCaptura.HasValue) form.Add(new StringContent(fechaCaptura.Value.ToString("O")), "fechaCaptura");

        return form;
    }

    private static string Sha256Hex(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    [Fact]
    public async Task CargaConsultaDescargaYEliminacion_FlujoCompletoMetadatosYAlmacenamientoPrivado()
    {
        var clientA = Client(_userA);
        var fechaCaptura = new DateTime(2026, 11, 20, 14, 30, 0, DateTimeKind.Utc);
        var mediaId = Guid.NewGuid();
        var expectedSha = Sha256Hex(ValidPngBytes);

        // 1. Carga (POST /api/media/archivos)
        using var form = BuildUploadForm(
            bytes: ValidPngBytes,
            fileName: "mi vaca favorita 2026.png",
            contentType: "image/png",
            idAnimal: _animalA1,
            idRancho: _ranchA,
            idArchivo: mediaId,
            tipo: "FotoPerfil",
            checksumSha256: expectedSha,
            fechaCaptura: fechaCaptura);

        var uploadRes = await clientA.PostAsync("/api/media/archivos", form);
        Assert.Equal(HttpStatusCode.Created, uploadRes.StatusCode);
        Assert.NotNull(uploadRes.Headers.Location);

        var created = (await uploadRes.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
        Assert.Equal(mediaId, created.IdArchivo);
        Assert.Equal(_ranchA, created.IdRancho);
        Assert.Equal(_animalA1, created.IdAnimal);
        Assert.Equal("FotoPerfil", created.Tipo);
        Assert.Equal("image/png", created.MimeType);
        Assert.Equal(".png", created.Extension);
        Assert.Equal(ValidPngBytes.Length, created.TamanoBytes);
        Assert.Equal(expectedSha, created.ChecksumSha256);
        Assert.Equal("LocalFileSystem", created.ProveedorAlmacenamiento);
        Assert.Equal(EstadosArchivoMultimedia.Disponible, created.Estado);
        Assert.Equal(fechaCaptura, created.FechaCaptura);
        Assert.True(created.FechaCarga >= fechaCaptura);
        Assert.Equal($"/api/media/archivos/{mediaId}/contenido", created.UrlContenido);

        // Verificar que la ruta física NO usa el nombre proporcionado por el usuario ni rutas absolutas/públicas
        Assert.DoesNotContain("mi vaca", created.RutaArchivo, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("public/imagenes", created.RutaArchivo, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("wwwroot", created.RutaArchivo, StringComparison.OrdinalIgnoreCase);
        Assert.False(Path.IsPathRooted(created.RutaArchivo));

        // Verificar en BD que solo existen metadatos (sin binarios) y en proveedor que existe el objeto físico
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
            var row = await db.ArchivosMultimedia.AsNoTracking().SingleAsync(m => m.IdArchivo == mediaId);
            Assert.Equal(EstadosArchivoMultimedia.Disponible, row.Estado);
            Assert.Equal("LocalFileSystem", row.ProveedorAlmacenamiento);
            Assert.Equal(".png", row.Extension);
            Assert.Equal(expectedSha, row.ChecksumSha256);
            Assert.Equal(_userA, row.IdAutor);

            var storage = scope.ServiceProvider.GetRequiredService<IMediaStorageProvider>();
            Assert.True(await storage.ExistsAsync(row.RutaArchivo));
        }

        // 2. Consulta por ID (GET /api/media/archivos/{id})
        var getMetaRes = await clientA.GetAsync($"/api/media/archivos/{mediaId}");
        Assert.Equal(HttpStatusCode.OK, getMetaRes.StatusCode);
        var meta = (await getMetaRes.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
        Assert.Equal(mediaId, meta.IdArchivo);
        Assert.Equal(EstadosArchivoMultimedia.Disponible, meta.Estado);

        // 3. Consulta listado con filtros (GET /api/media/archivos)
        var listRes = await clientA.GetAsync($"/api/media/archivos?idRancho={_ranchA}&idAnimal={_animalA1}&tipo=FotoPerfil&estado=Disponible");
        Assert.Equal(HttpStatusCode.OK, listRes.StatusCode);
        var list = (await listRes.Content.ReadFromJsonAsync<List<ArchivoMultimediaDto>>())!;
        Assert.Contains(list, x => x.IdArchivo == mediaId);

        // 4. Descarga autorizada del contenido binario (GET /api/media/archivos/{id}/contenido)
        var contentRes = await clientA.GetAsync(created.UrlContenido);
        Assert.Equal(HttpStatusCode.OK, contentRes.StatusCode);
        Assert.Equal("image/png", contentRes.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", contentRes.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.True(contentRes.Headers.CacheControl?.Private);
        Assert.True(contentRes.Headers.CacheControl?.NoStore);
        Assert.Equal(ValidPngBytes, await contentRes.Content.ReadAsByteArrayAsync());

        // 5. Eliminación autorizada (DELETE /api/media/archivos/{id})
        var deleteRes = await clientA.DeleteAsync($"/api/media/archivos/{mediaId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        // Reintento idempotente de eliminación -> 204 NoContent
        var deleteAgainRes = await clientA.DeleteAsync($"/api/media/archivos/{mediaId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteAgainRes.StatusCode);

        // Metadatos marcados como Eliminado y binario eliminado del proveedor físico
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
            var row = await db.ArchivosMultimedia.AsNoTracking().SingleAsync(m => m.IdArchivo == mediaId);
            Assert.Equal(EstadosArchivoMultimedia.Eliminado, row.Estado);
            Assert.NotNull(row.EliminadoEn);
            Assert.Equal(2, row.VersionRegistro);

            var storage = scope.ServiceProvider.GetRequiredService<IMediaStorageProvider>();
            Assert.False(await storage.ExistsAsync(row.RutaArchivo));
        }

        // Contenido ya no descargable (404), excluido del listado normal e incluido con incluirEliminados=true
        Assert.Equal(HttpStatusCode.NotFound, (await clientA.GetAsync(created.UrlContenido)).StatusCode);

        var listAfterDel = await (await clientA.GetAsync($"/api/media/archivos?idAnimal={_animalA1}"))
            .Content.ReadFromJsonAsync<List<ArchivoMultimediaDto>>();
        Assert.DoesNotContain(listAfterDel!, x => x.IdArchivo == mediaId);

        var listWithDeleted = await (await clientA.GetAsync($"/api/media/archivos?idAnimal={_animalA1}&incluirEliminados=true"))
            .Content.ReadFromJsonAsync<List<ArchivoMultimediaDto>>();
        Assert.Contains(listWithDeleted!, x => x.IdArchivo == mediaId && x.Estado == EstadosArchivoMultimedia.Eliminado);
    }

    [Fact]
    public async Task CargaFormatosPermitidos_JpegYWebp_DetectaMimeYExtensionReales()
    {
        var clientA = Client(_userA);

        using (var jpgForm = BuildUploadForm(ValidJpegBytes, "foto_bovino.jpeg", "image/jpeg", idAnimal: _animalA1, tipo: "FotoPerfil"))
        {
            var res = await clientA.PostAsync("/api/media/archivos", jpgForm);
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            var dto = (await res.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
            Assert.Equal("image/jpeg", dto.MimeType);
            Assert.Equal(".jpg", dto.Extension);
            Assert.Equal(ValidJpegBytes.Length, dto.TamanoBytes);
        }

        using (var webpForm = BuildUploadForm(ValidWebpBytes, "boviscale.webp", "image/webp", idAnimal: _animalA1, tipo: "BoviScaleVision"))
        {
            var res = await clientA.PostAsync("/api/media/archivos", webpForm);
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            var dto = (await res.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
            Assert.Equal("image/webp", dto.MimeType);
            Assert.Equal(".webp", dto.Extension);
            Assert.Equal("BoviScaleVision", dto.Tipo);
            Assert.Equal(ValidWebpBytes.Length, dto.TamanoBytes);
        }
    }

    [Fact]
    public async Task AccesoNoAutorizadoYAislamientoPorRancho_Bloquea401Y403EnTodosLosEndpoints()
    {
        var clientA = Client(_userA);
        var clientB = Client(_userB);
        var clientAnon = Client();
        var clientInactive = Client(_userInactive);
        var clientMulti = Client(_userMultiRanch);

        // Crear fotografía legítima en Rancho A
        var mediaAId = Guid.NewGuid();
        ArchivoMultimediaDto mediaA;
        using (var form = BuildUploadForm(ValidPngBytes, "privada.png", "image/png", idAnimal: _animalA1, idRancho: _ranchA, idArchivo: mediaAId))
        {
            var res = await clientA.PostAsync("/api/media/archivos", form);
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            mediaA = (await res.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
        }

        // 1. Anónimo -> 401 en todos los endpoints de archivos privados
        Assert.Equal(HttpStatusCode.Unauthorized, (await clientAnon.GetAsync("/api/media/archivos")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await clientAnon.GetAsync($"/api/media/archivos/{mediaAId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await clientAnon.GetAsync(mediaA.UrlContenido)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await clientAnon.DeleteAsync($"/api/media/archivos/{mediaAId}")).StatusCode);
        using (var anonUpload = BuildUploadForm(ValidPngBytes, "anon.png", "image/png", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await clientAnon.PostAsync("/api/media/archivos", anonUpload)).StatusCode);
        }

        // 2. Archivo privado jamás expuesto en ruta pública /api/media/{ruta}
        Assert.Equal(HttpStatusCode.NotFound, (await clientAnon.GetAsync($"/api/media/{mediaA.RutaArchivo}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await clientAnon.GetAsync($"/api/media/App_Data/media/{mediaA.RutaArchivo}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await clientAnon.GetAsync($"/api/media/public/imagenes/perfil-ganado/{_animalA1:N}/foto.png")).StatusCode);

        // 3. Usuario de Rancho B -> 403 Forbidden al consultar, descargar, subir o eliminar recursos de Rancho A
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.GetAsync($"/api/media/archivos?idRancho={_ranchA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.GetAsync($"/api/media/archivos?idAnimal={_animalA1}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.GetAsync($"/api/media/archivos/{mediaAId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.GetAsync(mediaA.UrlContenido)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientB.DeleteAsync($"/api/media/archivos/{mediaAId}")).StatusCode);

        // Listado general de Usuario B no debe filtrar archivos de Rancho A
        var listB = await (await clientB.GetAsync("/api/media/archivos")).Content.ReadFromJsonAsync<List<ArchivoMultimediaDto>>();
        Assert.DoesNotContain(listB!, x => x.IdArchivo == mediaAId);

        // Usuario B intentando subir foto a animal de Rancho A (con idRancho real o suplantando idRancho = ranchB) -> 403
        using (var crossUpload1 = BuildUploadForm(ValidPngBytes, "hack.png", "image/png", idAnimal: _animalA1, idRancho: _ranchA))
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PostAsync("/api/media/archivos", crossUpload1)).StatusCode);
        }
        using (var crossUpload2 = BuildUploadForm(ValidPngBytes, "spoof.png", "image/png", idAnimal: _animalA1, idRancho: _ranchB))
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PostAsync("/api/media/archivos", crossUpload2)).StatusCode);
        }
        // Usuario B probando idempotencia con el IdArchivo de Rancho A -> 403 (nunca filtra metadatos ajenos)
        using (var idempProbe = BuildUploadForm(ValidPngBytes, "probe.png", "image/png", idAnimal: _animalB1, idArchivo: mediaAId))
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await clientB.PostAsync("/api/media/archivos", idempProbe)).StatusCode);
        }

        // 4. Usuario inactivo -> 403 Forbidden
        Assert.Equal(HttpStatusCode.Forbidden, (await clientInactive.GetAsync($"/api/media/archivos/{mediaAId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientInactive.GetAsync(mediaA.UrlContenido)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await clientInactive.DeleteAsync($"/api/media/archivos/{mediaAId}")).StatusCode);

        // 5. Usuario miembro de ambos ranchos enviando incoherencia (animal de Rancho A con idRancho = Rancho B) -> 400 BadRequest
        using (var mismatchForm = BuildUploadForm(ValidPngBytes, "mismatch.png", "image/png", idAnimal: _animalA1, idRancho: _ranchB))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientMulti.PostAsync("/api/media/archivos", mismatchForm)).StatusCode);
        }

        // Confirmar que tras todos los intentos no autorizados el archivo de Rancho A sigue intacto
        var stillThere = await clientA.GetAsync(mediaA.UrlContenido);
        Assert.Equal(HttpStatusCode.OK, stillThere.StatusCode);
        Assert.Equal(ValidPngBytes, await stillThere.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task SeguridadValidacion_RechazaEjecutablesMimeFalsoExtensionIncorrectaPathTraversalYExcesoTamano()
    {
        var clientA = Client(_userA);

        // 1. Ejecutable Windows PE (MZ...) disfrazado de JPEG -> 400
        var peBytes = new byte[] { (byte)'M', (byte)'Z', 0x90, 0x00, 0x03, 0x00, 0x00, 0x00 };
        using (var form = BuildUploadForm(peBytes, "trojan.jpg", "image/jpeg", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 2. Binario ELF Linux disfrazado de PNG -> 400
        var elfBytes = new byte[] { 0x7F, (byte)'E', (byte)'L', (byte)'F', 0x02, 0x01, 0x01, 0x00 };
        using (var form = BuildUploadForm(elfBytes, "binary.png", "image/png", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 3. Script shell (#!) disfrazado de WebP -> 400
        var shBytes = Encoding.UTF8.GetBytes("#!/bin/sh\nrm -rf /\n");
        using (var form = BuildUploadForm(shBytes, "script.webp", "image/webp", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 4. SVG con XSS disfrazado de PNG -> 400
        var svgBytes = Encoding.UTF8.GetBytes("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>");
        using (var form = BuildUploadForm(svgBytes, "vector.png", "image/png", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 5. Extensión ejecutable (.exe, .php, .sh) incluso con bytes PNG válidos -> 400
        foreach (var badName in new[] { "payload.exe", "shell.php", "run.sh", "xss.svg" })
        {
            using var form = BuildUploadForm(ValidPngBytes, badName, "image/png", idAnimal: _animalA1);
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 6. Doble extensión ejecutable (shell.php.jpg, malware.exe.png) -> 400
        using (var form = BuildUploadForm(ValidPngBytes, "malware.exe.png", "image/png", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }
        using (var form = BuildUploadForm(ValidJpegBytes, "shell.php.jpg", "image/jpeg", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 7. MIME declarado no coincide con MIME real (bytes PNG declarados como image/jpeg) -> 400
        using (var form = BuildUploadForm(ValidPngBytes, "falso.jpg", "image/jpeg", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 8. Extensión no coincide con MIME real (bytes PNG nombrados .jpg con image/png) -> 400
        using (var form = BuildUploadForm(ValidPngBytes, "incorrecta.jpg", "image/png", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 9. Path traversal en nombre de archivo o campo NombreArchivo -> 400
        using (var form = BuildUploadForm(ValidPngBytes, "../../appsettings.png", "image/png", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }
        using (var form = BuildUploadForm(ValidPngBytes, "valida.png", "image/png", idAnimal: _animalA1, nombreArchivo: "..\\..\\secreto.png"))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 10. Checksum SHA-256 inválido -> 400 y sin archivo huérfano en disco
        var fakeSha = new string('a', 64);
        using (var form = BuildUploadForm(ValidPngBytes, "checksum_malo.png", "image/png", idAnimal: _animalA1, checksumSha256: fakeSha))
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 11. Archivo que excede el tamaño máximo permitido (10 MB + 128 bytes) -> 413 PayloadTooLarge
        var oversized = new byte[10 * 1024 * 1024 + 128];
        Array.Copy(ValidPngBytes, oversized, ValidPngBytes.Length);
        using (var form = BuildUploadForm(oversized, "gigante.png", "image/png", idAnimal: _animalA1))
        {
            Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }
    }

    [Fact]
    public async Task EvitaSobrescriturasAccidentales_MismoNombreYReintentosIdempotentes()
    {
        var clientA = Client(_userA);

        // 1. Subir dos fotos distintas para el mismo animal con el mismo nombre original "vaca.png"
        ArchivoMultimediaDto first;
        ArchivoMultimediaDto second;
        using (var f1 = BuildUploadForm(ValidPngBytes, "vaca.png", "image/png", idAnimal: _animalA1))
        {
            var r1 = await clientA.PostAsync("/api/media/archivos", f1);
            Assert.Equal(HttpStatusCode.Created, r1.StatusCode);
            first = (await r1.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
        }
        using (var f2 = BuildUploadForm(ValidPngBytes, "vaca.png", "image/png", idAnimal: _animalA1))
        {
            var r2 = await clientA.PostAsync("/api/media/archivos", f2);
            Assert.Equal(HttpStatusCode.Created, r2.StatusCode);
            second = (await r2.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
        }

        Assert.NotEqual(first.IdArchivo, second.IdArchivo);
        Assert.NotEqual(first.RutaArchivo, second.RutaArchivo);

        // Ambos archivos existen independientemente sin haberse sobrescrito
        Assert.Equal(HttpStatusCode.OK, (await clientA.GetAsync(first.UrlContenido)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await clientA.GetAsync(second.UrlContenido)).StatusCode);

        // 2. Reintento con el mismo IdArchivo y mismo animal -> 200 OK sin sobrescribir la ubicación física
        using (var retry = BuildUploadForm(ValidJpegBytes, "otro.jpg", "image/jpeg", idAnimal: _animalA1, idArchivo: first.IdArchivo))
        {
            var rRetry = await clientA.PostAsync("/api/media/archivos", retry);
            Assert.Equal(HttpStatusCode.OK, rRetry.StatusCode);
            var retried = (await rRetry.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
            Assert.Equal(first.RutaArchivo, retried.RutaArchivo);
            Assert.Equal(ValidPngBytes, await (await clientA.GetAsync(first.UrlContenido)).Content.ReadAsByteArrayAsync());
        }

        // 3. Reutilizar el mismo IdArchivo para otro animal -> 409 Conflict (nunca sobrescribe)
        using (var conflict = BuildUploadForm(ValidPngBytes, "vaca2.png", "image/png", idAnimal: _animalA2, idArchivo: first.IdArchivo))
        {
            var rConflict = await clientA.PostAsync("/api/media/archivos", conflict);
            Assert.Equal(HttpStatusCode.Conflict, rConflict.StatusCode);
        }

        // 4. Tras eliminar, reutilizar el mismo IdArchivo -> 409 Conflict
        Assert.Equal(HttpStatusCode.NoContent, (await clientA.DeleteAsync($"/api/media/archivos/{first.IdArchivo}")).StatusCode);
        using (var reuseDeleted = BuildUploadForm(ValidPngBytes, "reuso.png", "image/png", idAnimal: _animalA1, idArchivo: first.IdArchivo))
        {
            Assert.Equal(HttpStatusCode.Conflict, (await clientA.PostAsync("/api/media/archivos", reuseDeleted)).StatusCode);
        }
    }

    [Fact]
    public async Task LocalFileMediaStorageProvider_BloqueaWwwrootPathTraversalYDesbordeDeStream()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "farmbovi-storage-unit-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempRoot);
        try
        {
            // 1. Prohibir configurar el almacén privado dentro de wwwroot
            Assert.Throws<InvalidOperationException>(() => new LocalFileMediaStorageProvider(
                tempRoot,
                new MediaStorageOptions { PrivateRootPath = Path.Combine("wwwroot", "media") }));

            var provider = new LocalFileMediaStorageProvider(
                tempRoot,
                new MediaStorageOptions { PrivateRootPath = Path.Combine("App_Data", "media"), MaxFileSizeBytes = 1024 });

            // 2. Bloqueo de path traversal y rutas inválidas en resolución física
            Assert.Null(provider.ResolveSafePhysicalPath("../../appsettings.json"));
            Assert.Null(provider.ResolveSafePhysicalPath("/etc/passwd"));
            Assert.Null(provider.ResolveSafePhysicalPath("ranch\\cat\\file.jpg"));
            Assert.Null(provider.ResolveSafePhysicalPath("C:file.jpg"));
            Assert.Null(provider.ResolveSafePhysicalPath("ranch/cat/script.exe"));

            // 3. Límite duro durante streaming (stream supera MaxAllowedBytes y limpia archivo parcial)
            var oversizedPayload = new byte[2048];
            using (var ms = new MemoryStream(oversizedPayload))
            {
                var res = await provider.SaveAsync(new MediaStoreRequest(
                    IdArchivo: Guid.NewGuid(),
                    IdRancho: Guid.NewGuid(),
                    IdAnimal: Guid.NewGuid(),
                    Categoria: "perfil-ganado",
                    CanonicalExtension: ".png",
                    RealMimeType: "image/png",
                    MaxAllowedBytes: 512,
                    ContentStream: ms));

                Assert.False(res.Ok);
                Assert.True(res.IsTooLarge);
            }

            // Confirmar que no quedó ningún archivo huérfano tras el aborto por tamaño
            var leftoverFiles = Directory.Exists(provider.PrivateRootPath)
                ? Directory.GetFiles(provider.PrivateRootPath, "*", SearchOption.AllDirectories)
                : [];
            Assert.Empty(leftoverFiles);
        }
        finally
        {
            if (Directory.Exists(tempRoot))
                Directory.Delete(tempRoot, recursive: true);
        }
    }

    [Fact]
    public async Task EstrategiaAlmacenamientoDesacoplada_PermiteCambiarProveedorFisicoSinModificarControlador()
    {
        var fakeCloud = new InMemoryCloudMediaStorageProvider("CloudS3Mock");

        using var customFactory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                var existing = services.Where(d => d.ServiceType == typeof(IMediaStorageProvider)).ToList();
                foreach (var d in existing) services.Remove(d);
                services.AddSingleton<IMediaStorageProvider>(fakeCloud);
            });
        });

        var clientA = customFactory.CreateClient();
        clientA.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(_userA));

        var mediaId = Guid.NewGuid();
        using var form = BuildUploadForm(ValidPngBytes, "nube.png", "image/png", idAnimal: _animalA1, idArchivo: mediaId);
        var uploadRes = await clientA.PostAsync("/api/media/archivos", form);
        Assert.Equal(HttpStatusCode.Created, uploadRes.StatusCode);

        var dto = (await uploadRes.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
        Assert.Equal("CloudS3Mock", dto.ProveedorAlmacenamiento);
        Assert.True(await fakeCloud.ExistsAsync(dto.RutaArchivo));

        var downloadRes = await clientA.GetAsync(dto.UrlContenido);
        Assert.Equal(HttpStatusCode.OK, downloadRes.StatusCode);
        Assert.Equal(ValidPngBytes, await downloadRes.Content.ReadAsByteArrayAsync());

        var deleteRes = await clientA.DeleteAsync($"/api/media/archivos/{mediaId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);
        Assert.False(await fakeCloud.ExistsAsync(dto.RutaArchivo));
    }

    private sealed class InMemoryCloudMediaStorageProvider(string providerName) : IMediaStorageProvider
    {
        private readonly ConcurrentDictionary<string, (byte[] Bytes, string ContentType)> _objects = new(StringComparer.Ordinal);

        public string ProviderName => providerName;

        public async Task<MediaStoreResult> SaveAsync(MediaStoreRequest request, CancellationToken ct = default)
        {
            using var ms = new MemoryStream();
            await request.ContentStream.CopyToAsync(ms, ct);
            var data = ms.ToArray();
            var key = $"s3/{request.IdRancho:N}/{request.Categoria}/{request.IdArchivo:N}{request.CanonicalExtension}";
            if (!_objects.TryAdd(key, (data, request.RealMimeType)))
                return new MediaStoreResult(false, null, ProviderName, 0, null, "Colisión de objeto.");

            var sha = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
            return new MediaStoreResult(true, key, ProviderName, data.Length, sha);
        }

        public Task<MediaReadResult?> OpenReadAsync(string storageLocation, string contentType, CancellationToken ct = default)
        {
            if (!_objects.TryGetValue(storageLocation, out var entry))
                return Task.FromResult<MediaReadResult?>(null);

            return Task.FromResult<MediaReadResult?>(
                new MediaReadResult(new MemoryStream(entry.Bytes, writable: false), entry.ContentType, entry.Bytes.Length));
        }

        public Task<bool> DeleteAsync(string storageLocation, CancellationToken ct = default) =>
            Task.FromResult(_objects.TryRemove(storageLocation, out _));

        public Task<bool> ExistsAsync(string storageLocation, CancellationToken ct = default) =>
            Task.FromResult(_objects.ContainsKey(storageLocation));
    }
}
