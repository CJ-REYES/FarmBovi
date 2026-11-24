using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FarmBovi.Tests;

public sealed class UserProfileAndRegistrationTests : IClassFixture<FarmBoviApiFactory>
{
    private readonly FarmBoviApiFactory _factory;

    // PNG válido 1x1 (67 bytes)
    private static readonly byte[] ValidPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    public UserProfileAndRegistrationTests(FarmBoviApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Register_AllowAnonymous_CreaUsuarioDevuelveJwtYPermiteLogin()
    {
        var client = _factory.CreateClient();
        var email = $"patroclo.{Guid.NewGuid():N}@farmbovi.test";

        var registerRes = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "PATROCLO",
            Correo: email,
            Contrasena: "Carlos123_"));

        Assert.Equal(HttpStatusCode.Created, registerRes.StatusCode);
        var created = await registerRes.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(created);
        Assert.False(string.IsNullOrWhiteSpace(created.Token));
        Assert.Equal("PATROCLO", created.Nombre);
        Assert.Equal(email.ToLowerInvariant(), created.Correo);
        Assert.Null(created.FotoPerfilUrl);
        Assert.Equal("kg", created.Configuracion?.UnidadPeso);

        // Correo duplicado -> 409 Conflict
        var dupRes = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "Otro",
            Correo: email.ToUpperInvariant(),
            Contrasena: "Carlos123_"));
        Assert.Equal(HttpStatusCode.Conflict, dupRes.StatusCode);

        // Login inmediato con las credenciales recién registradas
        var loginRes = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "Carlos123_"));
        Assert.Equal(HttpStatusCode.OK, loginRes.StatusCode);
    }

    [Fact]
    public async Task PerfilUsuarioCrud_ActualizarDatos_CambiarContrasena_ConfiguracionYFotoConUrlTransformada()
    {
        var client = _factory.CreateClient();
        var email = $"ganadero.{Guid.NewGuid():N}@farmbovi.test";

        var registerRes = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "Carlos Original",
            Correo: email,
            Contrasena: "ClaveInicial123"));
        Assert.Equal(HttpStatusCode.Created, registerRes.StatusCode);
        var auth = (await registerRes.Content.ReadFromJsonAsync<LoginResponse>())!;

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.Token);

        // 1. GET /api/usuarios/me
        var meRes = await client.GetAsync("/api/usuarios/me");
        Assert.Equal(HttpStatusCode.OK, meRes.StatusCode);
        var me = (await meRes.Content.ReadFromJsonAsync<UsuarioResponse>())!;
        Assert.Equal("Carlos Original", me.Nombre);

        // 2. PUT /api/usuarios/me (actualizar nombre y correo)
        var newEmail = $"carlos.actualizado.{Guid.NewGuid():N}@farmbovi.test";
        var updateRes = await client.PutAsJsonAsync("/api/usuarios/me", new UpdateProfileRequest(
            Nombre: "Carlos Reyes",
            Correo: newEmail));
        Assert.Equal(HttpStatusCode.OK, updateRes.StatusCode);
        var updated = (await updateRes.Content.ReadFromJsonAsync<UsuarioResponse>())!;
        Assert.Equal("Carlos Reyes", updated.Nombre);
        Assert.Equal(newEmail, updated.Correo);

        // 3. PUT /api/usuarios/me/configuracion
        var configRes = await client.PutAsJsonAsync("/api/usuarios/me/configuracion", new UserConfigDto(
            UnidadPeso: "lb",
            DiasAvisoAlertas: 14,
            SincronizacionAutomatica: false,
            FormatoFecha: "yyyy-MM-dd",
            RanchoPredeterminadoId: null));
        Assert.Equal(HttpStatusCode.OK, configRes.StatusCode);
        var withConfig = (await configRes.Content.ReadFromJsonAsync<UsuarioResponse>())!;
        Assert.Equal("lb", withConfig.Configuracion?.UnidadPeso);
        Assert.Equal(14, withConfig.Configuracion?.DiasAvisoAlertas);
        Assert.False(withConfig.Configuracion?.SincronizacionAutomatica);

        // 4. POST /api/usuarios/me/foto -> guarda SOLO ruta en BD y devuelve URL lista para Frontend
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(ValidPngBytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(fileContent, "archivo", "perfil.png");

        var uploadRes = await client.PostAsync("/api/usuarios/me/foto", form);
        Assert.Equal(HttpStatusCode.OK, uploadRes.StatusCode);
        var withPhoto = (await uploadRes.Content.ReadFromJsonAsync<UsuarioResponse>())!;
        Assert.NotNull(withPhoto.FotoPerfilUrl);
        Assert.StartsWith("/api/media/public/imagenes/perfil-usuario/", withPhoto.FotoPerfilUrl);

        // Confirmar que en BD solo se almacenó la dirección relativa (sin /api/media ni Base64)
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
            var dbUser = await db.Usuarios.AsNoTracking().FirstAsync(u => u.Correo == newEmail);
            Assert.NotNull(dbUser.FotoPerfilRuta);
            Assert.StartsWith("public/imagenes/perfil-usuario/", dbUser.FotoPerfilRuta);
            Assert.DoesNotContain("base64", dbUser.FotoPerfilRuta, StringComparison.OrdinalIgnoreCase);
        }

        // Confirmar que la URL transformada sirve la imagen correctamente incluso sin header Authorization (<img src>)
        var anonClient = _factory.CreateClient();
        var imgRes = await anonClient.GetAsync(withPhoto.FotoPerfilUrl);
        Assert.Equal(HttpStatusCode.OK, imgRes.StatusCode);
        Assert.Equal("image/png", imgRes.Content.Headers.ContentType?.MediaType);
        var downloadedBytes = await imgRes.Content.ReadAsByteArrayAsync();
        Assert.Equal(ValidPngBytes, downloadedBytes);

        // Confirmar bloqueo de path traversal (nunca 200 OK y resuelto a null en servicio)
        var traversalRes = await anonClient.GetAsync("/api/media/uploads/..%2F..%2Fappsettings.json");
        Assert.True(
            traversalRes.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Unauthorized or HttpStatusCode.BadRequest);
        var storage = _factory.Services.GetRequiredService<FarmBovi.Api.Services.ProfilePhotoStorageService>();
        Assert.Null(storage.ResolvePhysicalFile("uploads/../../appsettings.json"));

        // 5. PUT /api/usuarios/me/contrasena
        var wrongPwdRes = await client.PutAsJsonAsync("/api/usuarios/me/contrasena", new ChangePasswordRequest(
            ContrasenaActual: "Incorrecta123",
            NuevaContrasena: "NuevaClave456!"));
        Assert.Equal(HttpStatusCode.BadRequest, wrongPwdRes.StatusCode);

        var okPwdRes = await client.PutAsJsonAsync("/api/usuarios/me/contrasena", new ChangePasswordRequest(
            ContrasenaActual: "ClaveInicial123",
            NuevaContrasena: "NuevaClave456!"));
        Assert.Equal(HttpStatusCode.OK, okPwdRes.StatusCode);

        // Verificar que la contraseña vieja ya no inicia sesión y la nueva sí (y trae FotoPerfilUrl + Configuracion)
        var oldLoginRes = await anonClient.PostAsJsonAsync("/api/auth/login", new LoginRequest(newEmail, "ClaveInicial123"));
        Assert.Equal(HttpStatusCode.Unauthorized, oldLoginRes.StatusCode);

        var newLoginRes = await anonClient.PostAsJsonAsync("/api/auth/login", new LoginRequest(newEmail, "NuevaClave456!"));
        Assert.Equal(HttpStatusCode.OK, newLoginRes.StatusCode);
        var relogin = (await newLoginRes.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.Equal(withPhoto.FotoPerfilUrl, relogin.FotoPerfilUrl);
        Assert.Equal("lb", relogin.Configuracion?.UnidadPeso);

        // 6. DELETE /api/usuarios/me/foto -> elimina archivo y limpia dirección en BD
        var delPhotoRes = await client.DeleteAsync("/api/usuarios/me/foto");
        Assert.Equal(HttpStatusCode.OK, delPhotoRes.StatusCode);
        var withoutPhoto = (await delPhotoRes.Content.ReadFromJsonAsync<UsuarioResponse>())!;
        Assert.Null(withoutPhoto.FotoPerfilUrl);

        var goneRes = await anonClient.GetAsync(withPhoto.FotoPerfilUrl);
        Assert.Equal(HttpStatusCode.NotFound, goneRes.StatusCode);
    }

    [Fact]
    public async Task Login_EmiteCookieHttpOnly_PermiteSessionYLogoutLaLimpia()
    {
        var email = $"cookie-{Guid.NewGuid():N}@farmbovi.mx";
        var registerClient = _factory.CreateClient();

        // 1. Register NO debe emitir cookie de sesión automática
        var regRes = await registerClient.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "Usuario PWA Cookie",
            Correo: email,
            Contrasena: "Password123!"));
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);
        var regSetCookies = regRes.Headers.TryGetValues("Set-Cookie", out var rCookies)
            ? rCookies.ToList()
            : [];
        Assert.DoesNotContain(regSetCookies, c => c.Contains(AuthController.AuthCookieName, StringComparison.OrdinalIgnoreCase));

        // 2. Login emite cookie HttpOnly, SameSite=Lax, Path=/api
        var loginRes = await registerClient.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "Password123!"));
        Assert.Equal(HttpStatusCode.OK, loginRes.StatusCode);
        Assert.True(loginRes.Headers.TryGetValues("Set-Cookie", out var loginCookies));
        var authCookieHeader = loginCookies.FirstOrDefault(c =>
            c.StartsWith($"{AuthController.AuthCookieName}=", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(authCookieHeader);
        Assert.Contains("httponly", authCookieHeader!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", authCookieHeader!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api", authCookieHeader!, StringComparison.OrdinalIgnoreCase);

        // 3. Cliente nuevo SIN header Authorization autentica GET /api/auth/session usando SOLO la cookie HttpOnly
        var cookiePair = authCookieHeader!.Split(';', 2)[0];
        var cookieOnlyClient = _factory.CreateClient();
        var sessionReq = new HttpRequestMessage(HttpMethod.Get, "/api/auth/session");
        sessionReq.Headers.Add("Cookie", cookiePair);
        var sessionRes = await cookieOnlyClient.SendAsync(sessionReq);
        Assert.Equal(HttpStatusCode.OK, sessionRes.StatusCode);

        var sessionInfo = (await sessionRes.Content.ReadFromJsonAsync<SessionInfoResponse>())!;
        Assert.Equal(email, sessionInfo.Correo);
        Assert.True(sessionInfo.ExpiraEn > DateTime.UtcNow);

        // 4. POST /api/auth/logout limpia la cookie HttpOnly
        var logoutRes = await cookieOnlyClient.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.OK, logoutRes.StatusCode);
        Assert.True(logoutRes.Headers.TryGetValues("Set-Cookie", out var logoutCookies));
        Assert.Contains(logoutCookies, c =>
            c.StartsWith($"{AuthController.AuthCookieName}=", StringComparison.OrdinalIgnoreCase) &&
            c.Contains("expires=", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task SyncPush_EliminarYaEliminadoEsIdempotente_YAreteDuplicadoInformaDetalle()
    {
        var email = $"sync409-{Guid.NewGuid():N}@farmbovi.mx";
        var client = _factory.CreateClient();

        var regRes = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "Ganadero Sync",
            Correo: email,
            Contrasena: "Password123!"));
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);
        var auth = (await regRes.Content.ReadFromJsonAsync<LoginResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.Token);

        // Crear rancho para el usuario
        var ranchId = Guid.NewGuid();
        var ranchRes = await client.PostAsJsonAsync("/api/ranchos", new
        {
            idRancho = ranchId,
            nombre = "Rancho Sync Test",
            ubicacionGeneral = "Jalisco",
            estado = "Activo"
        });
        Assert.Equal(HttpStatusCode.Created, ranchRes.StatusCode);

        // 1. Crear animal vía Sync Push
        var animalId = Guid.NewGuid();
        var createRes = await client.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = ranchId,
            idDispositivo = "test-device-01",
            entidad = "Animal",
            idRegistro = animalId,
            operacion = "Crear",
            payload = new
            {
                idAnimal = animalId,
                idRancho = ranchId,
                arete = "DUP-409-A",
                raza = "Brahman",
                sexo = "Hembra",
                fechaIngreso = "2026-11-22",
                procedencia = "Propio",
                estado = "Activo"
            }
        });
        Assert.Equal(HttpStatusCode.Created, createRes.StatusCode);

        // 2. Intentar crear otro animal con el MISMO arete -> 409 con mensaje diagnóstico claro
        var dupCreateRes = await client.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = ranchId,
            idDispositivo = "test-device-01",
            entidad = "Animal",
            idRegistro = Guid.NewGuid(),
            operacion = "Crear",
            payload = new
            {
                idRancho = ranchId,
                arete = "DUP-409-A",
                raza = "Angus",
                sexo = "Macho",
                fechaIngreso = "2026-11-22",
                procedencia = "Propio",
                estado = "Activo"
            }
        });
        Assert.Equal(HttpStatusCode.Conflict, dupCreateRes.StatusCode);
        var dupBody = await dupCreateRes.Content.ReadAsStringAsync();
        Assert.Contains("DUP-409-A", dupBody, StringComparison.OrdinalIgnoreCase);

        // 3. Eliminar el animal (v1 -> v2)
        var del1Res = await client.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = ranchId,
            idDispositivo = "test-device-01",
            entidad = "Animal",
            idRegistro = animalId,
            operacion = "Eliminar",
            versionBase = 1,
            payload = new { idAnimal = animalId }
        });
        Assert.Equal(HttpStatusCode.OK, del1Res.StatusCode);

        // 4. Otro intento de Eliminar sobre el registro ya eliminado -> 200 OK idempotente (no 409 DELETED_ON_SERVER)
        var del2Res = await client.PostAsJsonAsync("/api/sync/operaciones", new
        {
            idOperacion = Guid.NewGuid(),
            idRancho = ranchId,
            idDispositivo = "test-device-02",
            entidad = "Animal",
            idRegistro = animalId,
            operacion = "Eliminar",
            versionBase = 1,
            payload = new { idAnimal = animalId }
        });
        Assert.Equal(HttpStatusCode.OK, del2Res.StatusCode);
    }

    [Fact]
    public async Task TrasladoEntreRanchos_AnimalYLote_ActualizaRanchoYRegistraTrazabilidadYValidaSeguridad()
    {
        var client1 = _factory.CreateClient();
        var reg1 = await client1.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "Ganadero MultiRancho",
            Correo: $"multi-{Guid.NewGuid():N}@farmbovi.mx",
            Contrasena: "Password123!"));
        Assert.Equal(HttpStatusCode.Created, reg1.StatusCode);
        var auth1 = (await reg1.Content.ReadFromJsonAsync<LoginResponse>())!;
        client1.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth1.Token);

        // Crear Rancho A y Rancho B para el usuario 1
        var ranchA = Guid.NewGuid();
        var ranchB = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await client1.PostAsJsonAsync("/api/ranchos", new
        {
            idRancho = ranchA,
            nombre = "Rancho Origen",
            ubicacionGeneral = "Norte",
            estado = "Activo"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client1.PostAsJsonAsync("/api/ranchos", new
        {
            idRancho = ranchB,
            nombre = "Rancho Destino",
            ubicacionGeneral = "Sur",
            estado = "Activo"
        })).StatusCode);

        // Usuario 2 con Rancho C (sin acceso para Usuario 1)
        var client2 = _factory.CreateClient();
        var reg2 = await client2.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "Otro Ganadero",
            Correo: $"otro-{Guid.NewGuid():N}@farmbovi.mx",
            Contrasena: "Password123!"));
        var auth2 = (await reg2.Content.ReadFromJsonAsync<LoginResponse>())!;
        client2.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth2.Token);
        var ranchC = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await client2.PostAsJsonAsync("/api/ranchos", new
        {
            idRancho = ranchC,
            nombre = "Rancho Ajeno",
            ubicacionGeneral = "Oeste",
            estado = "Activo"
        })).StatusCode);

        // Crear Lote A1 en Rancho A, Lote B1 en Rancho B
        var lotA1 = Guid.NewGuid();
        var lotB1 = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await client1.PostAsJsonAsync("/api/lotes", new
        {
            idLote = lotA1,
            idRancho = ranchA,
            nombre = "Potrero Trasladable",
            ubicacion = "Zona 1",
            estado = "Activo"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client1.PostAsJsonAsync("/api/lotes", new
        {
            idLote = lotB1,
            idRancho = ranchB,
            nombre = "Potrero Recepcion",
            ubicacion = "Zona 2",
            estado = "Activo"
        })).StatusCode);

        // Crear Animal 1 y Animal 2 en Rancho A / Lote A1
        var animal1 = Guid.NewGuid();
        var animal2 = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await client1.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = animal1,
            idRancho = ranchA,
            idLote = lotA1,
            arete = "TR-001",
            raza = "Brahman",
            sexo = "Hembra",
            fechaIngreso = "2026-11-20",
            procedencia = "Propio",
            estado = "Activo"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client1.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = animal2,
            idRancho = ranchA,
            idLote = lotA1,
            arete = "TR-002",
            raza = "Angus",
            sexo = "Macho",
            fechaIngreso = "2026-11-20",
            procedencia = "Propio",
            estado = "Activo"
        })).StatusCode);

        // 1. Bloquear traslado hacia rancho ajeno (403 Forbidden)
        var forbiddenRes = await client1.PostAsJsonAsync("/api/movimientos-animales/traslado-rancho/animal", new
        {
            idAnimal = animal1,
            idRanchoDestino = ranchC,
            motivo = "Intento no autorizado"
        });
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenRes.StatusCode);

        // 2. Trasladar Animal 1 de Rancho A -> Rancho B (Potrero B1)
        var moveAnimalRes = await client1.PostAsJsonAsync("/api/movimientos-animales/traslado-rancho/animal", new
        {
            idAnimal = animal1,
            idRanchoDestino = ranchB,
            idLoteDestino = lotB1,
            motivo = "Traslado individual por pastura"
        });
        Assert.Equal(HttpStatusCode.OK, moveAnimalRes.StatusCode);
        var animalTransfer = (await moveAnimalRes.Content.ReadFromJsonAsync<TrasladoRanchoResultDto>())!;
        Assert.Equal(1, animalTransfer.AnimalesTrasladados);
        Assert.Equal(ranchB, animalTransfer.Animales[0].IdRancho);
        Assert.Equal(lotB1, animalTransfer.Animales[0].IdLote);
        Assert.Single(animalTransfer.Movimientos);
        Assert.Equal("Traslado", animalTransfer.Movimientos[0].Tipo);
        Assert.Equal("Rancho: Rancho Origen", animalTransfer.Movimientos[0].OrigenExterno);
        Assert.Equal("Rancho: Rancho Destino", animalTransfer.Movimientos[0].DestinoExterno);

        // 3. Trasladar Lote A1 completo (con Animal 2) de Rancho A -> Rancho B
        var moveLotRes = await client1.PostAsJsonAsync("/api/movimientos-animales/traslado-rancho/lote", new
        {
            idLote = lotA1,
            idRanchoDestino = ranchB,
            modoLote = "MoverLoteCompleto",
            motivo = "Rotación de lote completo"
        });
        Assert.Equal(HttpStatusCode.OK, moveLotRes.StatusCode);
        var lotTransfer = (await moveLotRes.Content.ReadFromJsonAsync<TrasladoRanchoResultDto>())!;
        Assert.Equal(1, lotTransfer.AnimalesTrasladados);
        Assert.NotNull(lotTransfer.LoteTrasladado);
        Assert.Equal(ranchB, lotTransfer.LoteTrasladado!.IdRancho);
        Assert.Equal(ranchB, lotTransfer.Animales[0].IdRancho);
        Assert.Equal(lotA1, lotTransfer.Animales[0].IdLote);
        Assert.Single(lotTransfer.Movimientos);
        Assert.Equal("Traslado", lotTransfer.Movimientos[0].Tipo);

        // 4. Si existe mismo arete en rancho destino -> 409 Conflict
        var dupAnimal = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await client1.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = dupAnimal,
            idRancho = ranchA,
            arete = "TR-001",
            raza = "Suizo",
            sexo = "Hembra",
            fechaIngreso = "2026-11-21",
            procedencia = "Propio",
            estado = "Activo"
        })).StatusCode);

        var dupMoveRes = await client1.PostAsJsonAsync("/api/movimientos-animales/traslado-rancho/animal", new
        {
            idAnimal = dupAnimal,
            idRanchoDestino = ranchB
        });
        Assert.Equal(HttpStatusCode.Conflict, dupMoveRes.StatusCode);
    }

    [Fact]
    public async Task MediaSync_GuardaSoloRutaEnBDYArchivosEnCarpetasPublicImagenes()
    {
        var client = _factory.CreateClient();
        var reg = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(
            Nombre: "Ganadero Fotos",
            Correo: $"media-{Guid.NewGuid():N}@farmbovi.mx",
            Contrasena: "Password123!"));
        Assert.Equal(HttpStatusCode.Created, reg.StatusCode);
        var auth = (await reg.Content.ReadFromJsonAsync<LoginResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.Token);

        var ranchId = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/ranchos", new
        {
            idRancho = ranchId,
            nombre = "Rancho Fotos",
            ubicacionGeneral = "Norte",
            estado = "Activo"
        })).StatusCode);

        var animalId = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = animalId,
            idRancho = ranchId,
            arete = "IMG-001",
            raza = "Holstein",
            sexo = "Hembra",
            fechaIngreso = "2026-11-22",
            procedencia = "Propio",
            estado = "Activo"
        })).StatusCode);

        // 1. Subir foto de perfil de ganado -> almacenamiento privado y acceso autenticado por rancho
        var profileMediaId = Guid.NewGuid();
        using (var form = new MultipartFormDataContent())
        {
            var fileContent = new ByteArrayContent(ValidPngBytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(fileContent, "archivo", "bovino.png");
            form.Add(new StringContent(profileMediaId.ToString()), "idArchivo");
            form.Add(new StringContent(animalId.ToString()), "idAnimal");
            form.Add(new StringContent(ranchId.ToString()), "idRancho");
            form.Add(new StringContent("FotoPerfil"), "tipo");

            var uploadRes = await client.PostAsync("/api/media/archivos", form);
            Assert.Equal(HttpStatusCode.Created, uploadRes.StatusCode);
            var uploaded = (await uploadRes.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
            Assert.Equal(profileMediaId, uploaded.IdArchivo);
            Assert.Contains("/perfil-ganado/", uploaded.RutaArchivo);
            Assert.DoesNotContain("public/imagenes/", uploaded.RutaArchivo);
            Assert.Equal($"/api/media/archivos/{profileMediaId}/contenido", uploaded.UrlContenido);
            Assert.Equal(uploaded.UrlContenido, uploaded.UrlPublica);
            Assert.Equal("Disponible", uploaded.Estado);
            Assert.Equal("LocalFileSystem", uploaded.ProveedorAlmacenamiento);

            // Verificar que un cliente anónimo NO puede acceder al archivo privado
            var anonClient = _factory.CreateClient();
            var anonRes = await anonClient.GetAsync(uploaded.UrlContenido);
            Assert.Equal(HttpStatusCode.Unauthorized, anonRes.StatusCode);

            // Verificar que el cliente autorizado SÍ descarga la imagen correctamente
            var imgRes = await client.GetAsync(uploaded.UrlContenido);
            Assert.Equal(HttpStatusCode.OK, imgRes.StatusCode);
            Assert.Equal(ValidPngBytes, await imgRes.Content.ReadAsByteArrayAsync());
        }

        // 2. Reintento idempotente con el mismo IdArchivo -> 200 OK sin duplicar
        using (var retryForm = new MultipartFormDataContent())
        {
            var fileContent = new ByteArrayContent(ValidPngBytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            retryForm.Add(fileContent, "archivo", "bovino.png");
            retryForm.Add(new StringContent(profileMediaId.ToString()), "idArchivo");
            retryForm.Add(new StringContent(animalId.ToString()), "idAnimal");
            retryForm.Add(new StringContent("FotoPerfil"), "tipo");

            var retryRes = await client.PostAsync("/api/media/archivos", retryForm);
            Assert.Equal(HttpStatusCode.OK, retryRes.StatusCode);
        }

        // 3. Subir foto de pesaje BoviScale -> almacenamiento privado bajo pesaje-ganado
        var weighMediaId = Guid.NewGuid();
        string weighUrl;
        using (var weighForm = new MultipartFormDataContent())
        {
            var fileContent = new ByteArrayContent(ValidPngBytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            weighForm.Add(fileContent, "archivo", "pesaje.png");
            weighForm.Add(new StringContent(weighMediaId.ToString()), "idArchivo");
            weighForm.Add(new StringContent(animalId.ToString()), "idAnimal");
            weighForm.Add(new StringContent("BoviScaleVision"), "tipo");

            var weighRes = await client.PostAsync("/api/media/archivos", weighForm);
            Assert.Equal(HttpStatusCode.Created, weighRes.StatusCode);
            var weighDto = (await weighRes.Content.ReadFromJsonAsync<ArchivoMultimediaDto>())!;
            Assert.Contains("/pesaje-ganado/", weighDto.RutaArchivo);
            Assert.Equal($"/api/media/archivos/{weighMediaId}/contenido", weighDto.UrlContenido);
            weighUrl = weighDto.UrlContenido;
        }

        // 4. Listar archivos sincronizados -> devuelve ambos registros con sus rutas y URLs
        var listRes = await client.GetAsync($"/api/media/archivos?idAnimal={animalId}");
        Assert.Equal(HttpStatusCode.OK, listRes.StatusCode);
        var items = (await listRes.Content.ReadFromJsonAsync<List<ArchivoMultimediaDto>>())!;
        Assert.Equal(2, items.Count);

        // 5. Eliminar archivo -> soft delete en BD y elimina archivo físico del disco
        var delRes = await client.DeleteAsync($"/api/media/archivos/{weighMediaId}");
        Assert.Equal(HttpStatusCode.NoContent, delRes.StatusCode);

        var goneImgRes = await client.GetAsync(weighUrl);
        Assert.Equal(HttpStatusCode.NotFound, goneImgRes.StatusCode);

        // Limpiar el otro archivo de prueba
        await client.DeleteAsync($"/api/media/archivos/{profileMediaId}");
    }
}
