using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services.BoviScale;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace FarmBovi.Tests;

public sealed class BoviScaleIntegrationTests : IAsyncLifetime
{
    private static readonly PasswordHasher<Usuario> Hasher = new();

    private const string InternalPythonUrl = "http://python-internal-secret.local:8765";
    private const string InternalPythonApiKey = "super-secret-python-api-key-998877";

    // PNG válido 1x1 (67 bytes)
    private static readonly byte[] ValidPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    private readonly FarmBoviApiFactory _baseFactory = new();
    private readonly StubPythonHttpHandler _pythonHandler = new();
    private readonly CapturingLoggerProvider _loggerProvider = new();
    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> _factory = null!;

    private readonly Guid _userA = Guid.NewGuid();
    private readonly Guid _userB = Guid.NewGuid();
    private readonly Guid _userInactive = Guid.NewGuid();
    private readonly Guid _ranchA = Guid.NewGuid();
    private readonly Guid _ranchB = Guid.NewGuid();
    private readonly Guid _animalA1 = Guid.NewGuid();
    private readonly Guid _animalA2 = Guid.NewGuid();
    private readonly Guid _animalB1 = Guid.NewGuid();
    private Guid _mediaA1;
    private Guid _mediaB1;

    public async Task InitializeAsync()
    {
        _factory = _baseFactory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("BoviScale:BaseUrl", InternalPythonUrl);
            builder.UseSetting("BoviScale:AnalyzeEndpoint", "/api/v1/estimate-weight");
            builder.UseSetting("BoviScale:ApiKeyHeaderName", "X-Api-Key");
            builder.UseSetting("BoviScale:ApiKey", InternalPythonApiKey);
            builder.UseSetting("BoviScale:TimeoutSeconds", "2");
            builder.UseSetting("BoviScale:MinValidWeightKg", "15");
            builder.UseSetting("BoviScale:MaxValidWeightKg", "2000");
            builder.UseSetting("BoviScale:AllowedWeightUnit", "kg");
            builder.UseSetting("BoviScale:ImageTransportFormat", "base64");

            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<ILoggerProvider>(_loggerProvider);
                services.AddHttpClient<IBoviScalePythonClient, BoviScalePythonClient>(client =>
                {
                    client.Timeout = Timeout.InfiniteTimeSpan;
                }).ConfigurePrimaryHttpMessageHandler(() => _pythonHandler);
            });
        });

        await SeedDomainAsync();
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        _baseFactory.Dispose();
        _pythonHandler.Dispose();
        _loggerProvider.Dispose();
        return Task.CompletedTask;
    }

    private async Task SeedDomainAsync()
    {
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
            var uA = NewUser(_userA, "Carlos Ganadero", "carlos.bs@farmbovi.test", "Activo");
            var uB = NewUser(_userB, "Pedro Externo", "pedro.bs@farmbovi.test", "Activo");
            var uInact = NewUser(_userInactive, "Usuario Inactivo", "inactivo.bs@farmbovi.test", "Inactivo");
            db.Usuarios.AddRange(uA, uB, uInact);

            db.Ranchos.AddRange(
                new Rancho { IdRancho = _ranchA, Nombre = "Rancho Norte", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = _userA },
                new Rancho { IdRancho = _ranchB, Nombre = "Rancho Sur", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = _userB });

            db.UsuarioRanchos.AddRange(
                new UsuarioRancho { IdUsuario = _userA, IdRancho = _ranchA, Rol = "Administrador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userB, IdRancho = _ranchB, Rol = "Administrador", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _userInactive, IdRancho = _ranchA, Rol = "Operador", Estado = "Activo" });

            db.Animales.AddRange(
                new Animal
                {
                    IdAnimal = _animalA1,
                    IdRancho = _ranchA,
                    Arete = "BS-A1",
                    Raza = "Brahman",
                    Sexo = "Hembra",
                    FechaNacimiento = new DateTime(2024, 5, 1, 0, 0, 0, DateTimeKind.Utc),
                    FechaIngreso = new DateTime(2025, 1, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userA
                },
                new Animal
                {
                    IdAnimal = _animalA2,
                    IdRancho = _ranchA,
                    Arete = "BS-A2",
                    Raza = "Angus",
                    Sexo = "Macho",
                    FechaIngreso = new DateTime(2025, 2, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userA
                },
                new Animal
                {
                    IdAnimal = _animalB1,
                    IdRancho = _ranchB,
                    Arete = "BS-B1",
                    Raza = "Holstein",
                    Sexo = "Hembra",
                    FechaIngreso = new DateTime(2025, 3, 10, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _userB
                });

            await db.SaveChangesAsync();
        }

        _mediaA1 = await UploadAnimalPhotoAsync(_userA, _ranchA, _animalA1);
        _mediaB1 = await UploadAnimalPhotoAsync(_userB, _ranchB, _animalB1);
    }

    private async Task<Guid> UploadAnimalPhotoAsync(Guid userId, Guid ranchId, Guid animalId)
    {
        var client = Client(userId);
        var mediaId = Guid.NewGuid();
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(ValidPngBytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(file, "archivo", "boviscale.png");
        form.Add(new StringContent(mediaId.ToString()), "idArchivo");
        form.Add(new StringContent(ranchId.ToString()), "idRancho");
        form.Add(new StringContent(animalId.ToString()), "idAnimal");
        form.Add(new StringContent("BoviScaleVision"), "tipo");

        var res = await client.PostAsync("/api/media/archivos", form);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return mediaId;
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

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, object payload) =>
        new(status)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };

    [Fact]
    public async Task RespuestaExitosa_EnviaJsonAcordadoAPython_RegistraPesajeYNoExponeSecretosNiFotosEnLogs()
    {
        _pythonHandler.Reset();
        _loggerProvider.Clear();

        var requestId = Guid.NewGuid();
        string? capturedBody = null;
        HttpRequestMessage? capturedReq = null;

        _pythonHandler.Handler = async (req, _) =>
        {
            capturedReq = req;
            capturedBody = await req.Content!.ReadAsStringAsync();
            return JsonResponse(HttpStatusCode.OK, new
            {
                request_id = requestId,
                animal_id = _animalA1,
                status = "completed",
                estimated_weight = 482.5,
                weight_unit = "kg",
                confidence = 0.8925,
                model_version = "boviscale-v1.2.0",
                processing_time_ms = 1140,
                notes = "Postura lateral correcta"
            });
        };

        var clientA = Client(_userA);
        var res = await clientA.PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idRancho = _ranchA,
            idArchivo = _mediaA1,
            anguloCaptura = "Lateral 90°",
            distanciaEstimadaCm = 210,
            observaciones = "Captura en manga"
        });

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var rawResponse = await res.Content.ReadAsStringAsync();

        // Nunca exponer URL interna ni credenciales de Python al navegador
        Assert.DoesNotContain(InternalPythonUrl, rawResponse, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(InternalPythonApiKey, rawResponse, StringComparison.OrdinalIgnoreCase);

        var dto = JsonSerializer.Deserialize<EstimacionPesoBoviScaleResponseDto>(
            rawResponse,
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        Assert.NotEqual(Guid.Empty, dto.IdPesaje);
        Assert.Equal(requestId, dto.IdSolicitud);
        Assert.Equal(_ranchA, dto.IdRancho);
        Assert.Equal(_animalA1, dto.IdAnimal);
        Assert.Equal(_mediaA1, dto.IdArchivoMultimedia);
        Assert.Equal(482.5m, dto.PesoEstimadoKg);
        Assert.Equal("kg", dto.UnidadPeso);
        Assert.Equal(0.8925m, dto.ConfianzaModelo);
        Assert.Equal("boviscale-v1.2.0", dto.VersionModelo);
        Assert.Equal("boviscale_ia", dto.OrigenPesaje);
        Assert.Equal("BoviScale IA (boviscale-v1.2.0)", dto.FuenteBascula);
        Assert.Equal("Carlos Ganadero", dto.Responsable);
        Assert.False(dto.DuplicadoIgnorado);
        Assert.Equal(1140, dto.TiempoProcesamientoMs);

        // Verificar solicitud HTTP enviada a Python (URL, headers y JSON exacto con Base64)
        Assert.NotNull(capturedReq);
        Assert.Equal($"{InternalPythonUrl}/api/v1/estimate-weight", capturedReq!.RequestUri!.ToString());
        Assert.Equal(InternalPythonApiKey, capturedReq.Headers.GetValues("X-Api-Key").Single());
        Assert.Equal(requestId.ToString(), capturedReq.Headers.GetValues("X-Idempotency-Key").Single());

        using var sentDoc = JsonDocument.Parse(capturedBody!);
        var root = sentDoc.RootElement;
        Assert.Equal(requestId.ToString(), root.GetProperty("request_id").GetString());
        Assert.Equal(_ranchA.ToString(), root.GetProperty("ranch_id").GetString());
        Assert.Equal(_animalA1.ToString(), root.GetProperty("animal_id").GetString());
        Assert.Equal(_mediaA1.ToString(), root.GetProperty("media_id").GetString());
        Assert.Equal("Brahman", root.GetProperty("animal_context").GetProperty("breed").GetString());
        Assert.Equal("base64", root.GetProperty("image").GetProperty("format").GetString());
        Assert.Equal("image/png", root.GetProperty("image").GetProperty("mime_type").GetString());
        Assert.Equal(Convert.ToBase64String(ValidPngBytes), root.GetProperty("image").GetProperty("data").GetString());

        // Verificar persistencia real en la tabla existente Pesaje + CambioServidor para Sync Pull
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
            var saved = await db.Pesajes.AsNoTracking().SingleAsync(p => p.IdSolicitud == requestId);
            Assert.Equal(dto.IdPesaje, saved.IdPesaje);
            Assert.Equal(_animalA1, saved.IdAnimal);
            Assert.Equal(_mediaA1, saved.IdArchivoMultimedia);
            Assert.Equal(482.5m, saved.PesoRealKg);
            Assert.Equal("boviscale_ia", saved.OrigenPesaje);

            var syncChange = await db.CambiosServidor.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Entidad == nameof(Pesaje) && c.IdRegistro == saved.IdPesaje);
            Assert.NotNull(syncChange);
            Assert.Equal(_ranchA, syncChange!.IdRancho);
        }

        // Consultar estimación registrada por GET
        var getRes = await clientA.GetAsync($"/api/boviscale/estimaciones/{requestId}");
        Assert.Equal(HttpStatusCode.OK, getRes.StatusCode);

        // Verificar que los logs técnicos NO registran Base64 de la foto ni el secreto API Key
        var allLogs = string.Join("\n", _loggerProvider.Messages);
        Assert.Contains(requestId.ToString(), allLogs);
        Assert.DoesNotContain(Convert.ToBase64String(ValidPngBytes), allLogs);
        Assert.DoesNotContain(InternalPythonApiKey, allLogs);
    }

    [Fact]
    public async Task ErrorDeConexionConPython_Retorna503YNoRegistraPesaje()
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();
        _pythonHandler.Handler = (_, _) => throw new HttpRequestException("Connection refused");

        var res = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.DoesNotContain(InternalPythonUrl, body, StringComparison.OrdinalIgnoreCase);

        await AssertNoPesajeRecordedAsync(requestId);
    }

    [Fact]
    public async Task TiempoDeEsperaAgotado_Retorna504YNoRegistraPesaje()
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();
        _pythonHandler.Handler = async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(10), ct);
            return JsonResponse(HttpStatusCode.OK, new { });
        };

        var res = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });

        Assert.Equal(HttpStatusCode.GatewayTimeout, res.StatusCode);
        await AssertNoPesajeRecordedAsync(requestId);
    }

    [Fact]
    public async Task JsonInvalido_ORespuestaCorrupta_Retorna502YNoRegistraPesaje()
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();
        _pythonHandler.Handler = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{json_malformado_sin_cierre", Encoding.UTF8, "application/json")
        });

        var res = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });

        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
        await AssertNoPesajeRecordedAsync(requestId);
    }

    [Theory]
    [InlineData(-45.5, "kg")]
    [InlineData(0, "kg")]
    [InlineData(5.0, "kg")]      // < MinValidWeightKg (15)
    [InlineData(3500.0, "kg")]   // > MaxValidWeightKg (2000)
    [InlineData(450.0, "lb")]    // unidad distinta a "kg"
    [InlineData(450.0, "")]      // unidad faltante
    public async Task PesoInvalidoOFueraDeLimitesOUnidadIncorrecta_Retorna502YNoRegistraPesaje(
        double rawWeight,
        string unit)
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();
        _pythonHandler.Handler = (_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK, new
        {
            request_id = requestId,
            animal_id = _animalA1,
            status = "completed",
            estimated_weight = rawWeight,
            weight_unit = unit,
            confidence = 0.85,
            model_version = "boviscale-v1.0.0"
        }));

        var res = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });

        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
        await AssertNoPesajeRecordedAsync(requestId);
    }

    [Fact]
    public async Task ErrorDelModelo422YRateLimit429_NoConviertenErroresEnPesajes()
    {
        _pythonHandler.Reset();

        // 422 del modelo (imagen rechazada)
        var req422 = Guid.NewGuid();
        _pythonHandler.Handler = (_, _) => Task.FromResult(JsonResponse(HttpStatusCode.UnprocessableEntity, new
        {
            request_id = req422,
            status = "rejected_image",
            error = new { code = "ANIMAL_NOT_DETECTED", message = "No se detectó un bovino.", retryable = false }
        }));

        var res422 = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = req422,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res422.StatusCode);
        await AssertNoPesajeRecordedAsync(req422);

        // 429 con Retry-After propagado
        var req429 = Guid.NewGuid();
        _pythonHandler.Handler = (_, _) =>
        {
            var resp = JsonResponse(HttpStatusCode.TooManyRequests, new { code = "RATE_LIMITED" });
            resp.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(45));
            return Task.FromResult(resp);
        };

        var res429 = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = req429,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });
        Assert.Equal(HttpStatusCode.TooManyRequests, res429.StatusCode);
        Assert.Equal("45", res429.Headers.RetryAfter?.Delta?.TotalSeconds.ToString("0"));
        await AssertNoPesajeRecordedAsync(req429);
    }

    [Fact]
    public async Task AnimalInexistente_Retorna404SinInvocarAPython()
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();

        var res = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = Guid.NewGuid(),
            idArchivo = _mediaA1
        });

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal(0, _pythonHandler.CallCount);
        await AssertNoPesajeRecordedAsync(requestId);
    }

    [Fact]
    public async Task UsuarioSinAutorizacionYAnimalDeOtroRancho_Bloquea401Y403SinInvocarAPython()
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();

        // 1. Anónimo -> 401
        var anonRes = await Client().PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });
        Assert.Equal(HttpStatusCode.Unauthorized, anonRes.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Client().GetAsync($"/api/boviscale/estimaciones/{requestId}")).StatusCode);

        // 2. Usuario inactivo -> 403
        var inactiveRes = await Client(_userInactive).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });
        Assert.Equal(HttpStatusCode.Forbidden, inactiveRes.StatusCode);

        // 3. Usuario de Rancho B intentando estimar animal de Rancho A -> 403
        var crossRanchRes = await Client(_userB).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });
        Assert.Equal(HttpStatusCode.Forbidden, crossRanchRes.StatusCode);

        // 4. Usuario de Rancho B intentando usar foto de Rancho B para animal de Rancho A -> 403
        var crossPhotoRes = await Client(_userB).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaB1
        });
        Assert.Equal(HttpStatusCode.Forbidden, crossPhotoRes.StatusCode);

        Assert.Equal(0, _pythonHandler.CallCount);
        await AssertNoPesajeRecordedAsync(requestId);
    }

    [Fact]
    public async Task SolicitudDuplicada_SecuencialYConcurrente_EvitaInvocarDosVecesYEvitaPesajesDuplicados()
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();

        _pythonHandler.Handler = async (_, ct) =>
        {
            await Task.Delay(120, ct);
            return JsonResponse(HttpStatusCode.OK, new
            {
                request_id = requestId,
                animal_id = _animalA1,
                status = "completed",
                estimated_weight = 510.25,
                weight_unit = "kg",
                confidence = 0.91,
                model_version = "boviscale-v1.3.0"
            });
        };

        var payload = new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        };

        // 1. Dos solicitudes concurrentes con el mismo IdSolicitud
        var client1 = Client(_userA);
        var client2 = Client(_userA);
        var responses = await Task.WhenAll(
            client1.PostAsJsonAsync("/api/boviscale/estimaciones", payload),
            client2.PostAsJsonAsync("/api/boviscale/estimaciones", payload));

        var statusCodes = responses.Select(r => r.StatusCode).OrderBy(s => (int)s).ToList();
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Created], statusCodes);
        Assert.Equal(1, _pythonHandler.CallCount);

        var dto1 = (await responses[0].Content.ReadFromJsonAsync<EstimacionPesoBoviScaleResponseDto>())!;
        var dto2 = (await responses[1].Content.ReadFromJsonAsync<EstimacionPesoBoviScaleResponseDto>())!;
        Assert.Equal(dto1.IdPesaje, dto2.IdPesaje);
        Assert.True(dto1.DuplicadoIgnorado ^ dto2.DuplicadoIgnorado);

        // 2. Tercer reintento secuencial -> 200 OK con DuplicadoIgnorado=true y sin llamar a Python
        var retryRes = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", payload);
        Assert.Equal(HttpStatusCode.OK, retryRes.StatusCode);
        var dto3 = (await retryRes.Content.ReadFromJsonAsync<EstimacionPesoBoviScaleResponseDto>())!;
        Assert.Equal(dto1.IdPesaje, dto3.IdPesaje);
        Assert.True(dto3.DuplicadoIgnorado);
        Assert.Equal(1, _pythonHandler.CallCount);

        // 3. Reutilizar el mismo IdSolicitud con otro animal -> 409 Conflict
        var conflictRes = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA2,
            idArchivo = _mediaA1
        });
        Assert.Equal(HttpStatusCode.Conflict, conflictRes.StatusCode);
        Assert.Equal(1, _pythonHandler.CallCount);

        // 4. Usuario de otro rancho sondeando ese IdSolicitud -> 403 Forbidden
        Assert.Equal(HttpStatusCode.Forbidden, (await Client(_userB).PostAsJsonAsync("/api/boviscale/estimaciones", payload)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Client(_userB).GetAsync($"/api/boviscale/estimaciones/{requestId}")).StatusCode);

        // Confirmar exactamente 1 registro en Pesaje
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
        var count = await db.Pesajes.AsNoTracking().CountAsync(p => p.IdSolicitud == requestId);
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task FotografiaInvalidaODemasiadoGrandeOEliminada_RechazaAntesDeInvocarAPython()
    {
        _pythonHandler.Reset();
        var clientA = Client(_userA);

        // 1. Escenario 2: Fotografía inválida (archivo ejecutable disfrazado de PNG) -> 400 BadRequest
        var fakeExe = new byte[] { (byte)'M', (byte)'Z', 0x90, 0x00, 0x03, 0x00, 0x00, 0x00 };
        using (var form = new MultipartFormDataContent())
        {
            var file = new ByteArrayContent(fakeExe);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(file, "archivo", "invalida.png");
            form.Add(new StringContent(_ranchA.ToString()), "idRancho");
            form.Add(new StringContent(_animalA1.ToString()), "idAnimal");
            form.Add(new StringContent("BoviScaleVision"), "tipo");
            Assert.Equal(HttpStatusCode.BadRequest, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 2. Escenario 3: Fotografía demasiado grande (> 10 MB) -> 413 PayloadTooLarge
        var oversized = new byte[10 * 1024 * 1024 + 256];
        Array.Copy(ValidPngBytes, oversized, ValidPngBytes.Length);
        using (var form = new MultipartFormDataContent())
        {
            var file = new ByteArrayContent(oversized);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(file, "archivo", "enorme.png");
            form.Add(new StringContent(_ranchA.ToString()), "idRancho");
            form.Add(new StringContent(_animalA1.ToString()), "idAnimal");
            form.Add(new StringContent("BoviScaleVision"), "tipo");
            Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await clientA.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // 3. Fotografía eliminada referenciada en BoviScale -> 400 BadRequest sin invocar a Python
        var deletedPhotoId = await UploadAnimalPhotoAsync(_userA, _ranchA, _animalA1);
        Assert.Equal(HttpStatusCode.NoContent, (await clientA.DeleteAsync($"/api/media/archivos/{deletedPhotoId}")).StatusCode);

        var reqId = Guid.NewGuid();
        var estRes = await clientA.PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = reqId,
            idAnimal = _animalA1,
            idArchivo = deletedPhotoId
        });
        Assert.Equal(HttpStatusCode.BadRequest, estRes.StatusCode);
        Assert.Equal(0, _pythonHandler.CallCount);
        await AssertNoPesajeRecordedAsync(reqId);
    }

    [Theory]
    [InlineData("{\"request_id\": \"00000000-0000-0000-0000-000000000000\", \"status\": \"completed\"}")]
    [InlineData("{\"status\": \"completed\", \"weight_unit\": \"kg\"}")]
    [InlineData("{\"estimated_weight\": 450.0, \"weight_unit\": \"kg\"}")]
    [InlineData("{}")]
    public async Task RespuestaJsonIncompleta_Retorna502YNoRegistraPesaje(string incompleteJson)
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();
        _pythonHandler.Handler = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(incompleteJson, Encoding.UTF8, "application/json")
        });

        var res = await Client(_userA).PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = _mediaA1
        });

        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
        await AssertNoPesajeRecordedAsync(requestId);
    }

    [Fact]
    public async Task ReintentoDeSolicitudTrasFalloEnPython_RegistraPesajeEnSegundoIntentoConMismoIdSolicitud()
    {
        _pythonHandler.Reset();
        var requestId = Guid.NewGuid();
        var attempt = 0;

        _pythonHandler.Handler = (_, _) =>
        {
            attempt++;
            if (attempt == 1)
            {
                return Task.FromResult(JsonResponse(HttpStatusCode.ServiceUnavailable, new
                {
                    code = "INFERENCE_OVERLOAD",
                    message = "Worker Python saturado"
                }));
            }

            return Task.FromResult(JsonResponse(HttpStatusCode.OK, new
            {
                request_id = requestId,
                animal_id = _animalA1,
                status = "completed",
                estimated_weight = 490.75,
                weight_unit = "kg",
                confidence = 0.88,
                model_version = "boviscale-v1.3.0"
            }));
        };

        var payload = new { idSolicitud = requestId, idAnimal = _animalA1, idArchivo = _mediaA1 };
        var clientA = Client(_userA);

        // Intento 1: fallo 503 -> no persiste pesaje
        var res1 = await clientA.PostAsJsonAsync("/api/boviscale/estimaciones", payload);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, res1.StatusCode);
        await AssertNoPesajeRecordedAsync(requestId);

        // Intento 2: reintento con el mismo IdSolicitud -> 201 Created y 1 pesaje registrado
        var res2 = await clientA.PostAsJsonAsync("/api/boviscale/estimaciones", payload);
        Assert.Equal(HttpStatusCode.Created, res2.StatusCode);
        var dto = (await res2.Content.ReadFromJsonAsync<EstimacionPesoBoviScaleResponseDto>())!;
        Assert.Equal(490.75m, dto.PesoEstimadoKg);
        Assert.False(dto.DuplicadoIgnorado);
        Assert.Equal(2, _pythonHandler.CallCount);

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
        Assert.Equal(1, await db.Pesajes.AsNoTracking().CountAsync(p => p.IdSolicitud == requestId));
    }

    [Fact]
    public async Task ErrorDePersistenciaEnMySql_Retorna500SeguroSinFiltrarCredencialesYNoDejaPesajePersistido()
    {
        var failingInterceptor = new FailingPesajeSaveInterceptor();
        var pythonStub = new StubPythonHttpHandler();
        var dbName = "boviscale-db-fail-" + Guid.NewGuid().ToString("N");

        using var dbFailFactory = _baseFactory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("BoviScale:BaseUrl", InternalPythonUrl);
            builder.UseSetting("BoviScale:AnalyzeEndpoint", "/api/v1/estimate-weight");
            builder.UseSetting("BoviScale:ApiKey", InternalPythonApiKey);
            builder.UseSetting("BoviScale:TimeoutSeconds", "5");

            builder.ConfigureTestServices(services =>
            {
                var dbDescriptors = services.Where(d =>
                    d.ServiceType == typeof(DbContextOptions<FarmDbContext>) ||
                    d.ServiceType == typeof(DbContextOptions) ||
                    d.ServiceType == typeof(FarmDbContext)).ToList();
                foreach (var d in dbDescriptors) services.Remove(d);

                services.AddDbContext<FarmDbContext>(options => options
                    .UseInMemoryDatabase(dbName)
                    .AddInterceptors(failingInterceptor)
                    .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

                services.AddHttpClient<IBoviScalePythonClient, BoviScalePythonClient>(client =>
                {
                    client.Timeout = Timeout.InfiniteTimeSpan;
                }).ConfigurePrimaryHttpMessageHandler(() => pythonStub);
            });
        });

        // Sembrar usuario, rancho y animal (interceptor solo falla al guardar Pesaje)
        await using (var scope = dbFailFactory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
            db.Usuarios.Add(NewUser(_userA, "Ganadero Fail", "fail@farmbovi.test", "Activo"));
            db.Ranchos.Add(new Rancho { IdRancho = _ranchA, Nombre = "Rancho Fail", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = _userA });
            db.UsuarioRanchos.Add(new UsuarioRancho { IdUsuario = _userA, IdRancho = _ranchA, Rol = "Administrador", Estado = "Activo" });
            db.Animales.Add(new Animal
            {
                IdAnimal = _animalA1,
                IdRancho = _ranchA,
                Arete = "FAIL-01",
                Raza = "Holstein",
                Sexo = "Hembra",
                FechaIngreso = DateTime.UtcNow.Date,
                Procedencia = "Propio",
                Estado = "Activo",
                IdAutor = _userA
            });
            await db.SaveChangesAsync();
        }

        var client = dbFailFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(_userA));

        // Subir fotografía válida
        var photoId = Guid.NewGuid();
        using (var form = new MultipartFormDataContent())
        {
            var file = new ByteArrayContent(ValidPngBytes);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(file, "archivo", "dbfail.png");
            form.Add(new StringContent(photoId.ToString()), "idArchivo");
            form.Add(new StringContent(_ranchA.ToString()), "idRancho");
            form.Add(new StringContent(_animalA1.ToString()), "idAnimal");
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/media/archivos", form)).StatusCode);
        }

        // Python responde OK, pero MySQL falla al guardar el Pesaje
        var requestId = Guid.NewGuid();
        pythonStub.Handler = (_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK, new
        {
            request_id = requestId,
            animal_id = _animalA1,
            status = "completed",
            estimated_weight = 470.0,
            weight_unit = "kg",
            confidence = 0.9,
            model_version = "boviscale-v1.0.0"
        }));

        failingInterceptor.FailNextPesajeSave = true;

        var res = await client.PostAsJsonAsync("/api/boviscale/estimaciones", new
        {
            idSolicitud = requestId,
            idAnimal = _animalA1,
            idArchivo = photoId
        });

        Assert.Equal(HttpStatusCode.InternalServerError, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Password=", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(InternalPythonApiKey, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(InternalPythonUrl, body, StringComparison.OrdinalIgnoreCase);

        await using (var scope = dbFailFactory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
            Assert.False(await db.Pesajes.AsNoTracking().AnyAsync(p => p.IdSolicitud == requestId));
        }
    }

    private sealed class FailingPesajeSaveInterceptor : SaveChangesInterceptor
    {
        public bool FailNextPesajeSave { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (FailNextPesajeSave &&
                eventData.Context is not null &&
                eventData.Context.ChangeTracker.Entries<Pesaje>().Any(e => e.State == EntityState.Added))
            {
                FailNextPesajeSave = false;
                throw new DbUpdateException(
                    "Simulated MySQL error (Server=localhost;Password=159753;): Lost connection to MySQL server during query");
            }

            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private async Task AssertNoPesajeRecordedAsync(Guid requestId)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
        Assert.False(await db.Pesajes.AsNoTracking().AnyAsync(p => p.IdSolicitud == requestId));
    }

    private sealed class StubPythonHttpHandler : HttpMessageHandler
    {
        private int _callCount;
        public int CallCount => Volatile.Read(ref _callCount);
        public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>? Handler { get; set; }

        public void Reset()
        {
            Interlocked.Exchange(ref _callCount, 0);
            Handler = null;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _callCount);
            if (Handler is null)
                throw new InvalidOperationException("StubPythonHttpHandler no configurado para la prueba.");
            return Handler(request, cancellationToken);
        }
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public ConcurrentQueue<string> Messages { get; } = new();

        public void Clear()
        {
            while (Messages.TryDequeue(out _)) { }
        }

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(Messages);
        public void Dispose() { }

        private sealed class CapturingLogger(ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                messages.Enqueue(formatter(state, exception));
            }
        }
    }
}
