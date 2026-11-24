using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Identity;
using Xunit;

namespace FarmBovi.Tests;

/// <summary>
/// Pruebas de contratos DTO, validaciones reales, consistencia RFC 7807 (ProblemDetails /
/// ValidationProblemDetails), idempotencia, aislamiento por rancho y política UTC (BE-P05).
/// </summary>
public sealed class ContractsValidationAndProblemDetailsTests : IAsyncLifetime
{
    private static readonly PasswordHasher<Usuario> Hasher = new();
    private readonly FarmBoviApiFactory _factory = new();

    private readonly Guid _adminA = Guid.NewGuid();
    private readonly Guid _adminB = Guid.NewGuid();
    private readonly Guid _ranchA = Guid.NewGuid();
    private readonly Guid _ranchB = Guid.NewGuid();
    private readonly Guid _loteA1 = Guid.NewGuid();
    private readonly Guid _loteA2 = Guid.NewGuid();
    private readonly Guid _loteB1 = Guid.NewGuid();
    private readonly Guid _animalA = Guid.NewGuid();
    private readonly Guid _animalB = Guid.NewGuid();
    private readonly Guid _eventA = Guid.NewGuid();
    private readonly Guid _alimentacionA = Guid.NewGuid();
    private readonly Guid _recordatorioA = Guid.NewGuid();
    private readonly Guid _movimientoA = Guid.NewGuid();
    private readonly Guid _usuarioRanchoA = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _factory.SeedAsync(db =>
        {
            Usuario MakeUser(Guid id, string name)
            {
                var u = new Usuario
                {
                    IdUsuario = id,
                    Nombre = name,
                    Correo = $"{name.ToLowerInvariant()}.{id:N}@farmbovi.test",
                    Estado = "Activo"
                };
                u.Contrasena = Hasher.HashPassword(u, "ClaveSegura123!");
                return u;
            }

            db.Usuarios.AddRange(MakeUser(_adminA, "AdminA"), MakeUser(_adminB, "AdminB"));
            db.Ranchos.AddRange(
                new Rancho { IdRancho = _ranchA, Nombre = "Rancho Alpha", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = _adminA },
                new Rancho { IdRancho = _ranchB, Nombre = "Rancho Beta", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = _adminB });
            db.UsuarioRanchos.AddRange(
                new UsuarioRancho { IdUsuarioRancho = _usuarioRanchoA, IdUsuario = _adminA, IdRancho = _ranchA, Rol = "Admin", Estado = "Activo" },
                new UsuarioRancho { IdUsuarioRancho = Guid.NewGuid(), IdUsuario = _adminB, IdRancho = _ranchB, Rol = "Admin", Estado = "Activo" });
            db.Lotes.AddRange(
                new Lote { IdLote = _loteA1, IdRancho = _ranchA, Nombre = "Potrero A1", Estado = "Activo", IdAutor = _adminA },
                new Lote { IdLote = _loteA2, IdRancho = _ranchA, Nombre = "Potrero A2", Estado = "Activo", IdAutor = _adminA },
                new Lote { IdLote = _loteB1, IdRancho = _ranchB, Nombre = "Potrero B1", Estado = "Activo", IdAutor = _adminB });
            db.Animales.AddRange(
                new Animal
                {
                    IdAnimal = _animalA,
                    IdRancho = _ranchA,
                    IdLote = _loteA1,
                    Arete = "ALPHA-001",
                    Raza = "Brahman",
                    Sexo = "Hembra",
                    FechaIngreso = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _adminA
                },
                new Animal
                {
                    IdAnimal = _animalB,
                    IdRancho = _ranchB,
                    IdLote = _loteB1,
                    Arete = "BETA-001",
                    Raza = "Angus",
                    Sexo = "Macho",
                    FechaIngreso = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc),
                    Procedencia = "Propio",
                    Estado = "Activo",
                    IdAutor = _adminB
                });
            db.EventosSanitarios.Add(new EventoSanitario
            {
                IdEventoSanitario = _eventA,
                IdAnimal = _animalA,
                Tipo = "Vacuna",
                Fecha = new DateTime(2026, 5, 2, 10, 0, 0, DateTimeKind.Utc),
                Responsable = "MVZ",
                IdAutor = _adminA
            });
            db.Alimentaciones.Add(new Alimentacion
            {
                IdAlimentacion = _alimentacionA,
                IdAnimal = _animalA,
                Alimento = "Forraje",
                Racion = "Ración A",
                Cantidad = 10m,
                Unidad = "kg",
                Frecuencia = "Diaria",
                Inicio = new DateTime(2026, 5, 2, 8, 0, 0, DateTimeKind.Utc),
                IdAutor = _adminA
            });
            db.Recordatorios.Add(new Recordatorio
            {
                IdRecordatorio = _recordatorioA,
                IdRancho = _ranchA,
                IdAnimal = _animalA,
                Tipo = "Sanitario",
                Descripcion = "Refuerzo",
                FechaProgramada = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc),
                Estado = "Pendiente",
                IdAutor = _adminA
            });
            db.MovimientosAnimales.Add(new MovimientoAnimal
            {
                IdMovimiento = _movimientoA,
                IdAnimal = _animalA,
                IdLoteOrigen = null,
                IdLoteDestino = _loteA1,
                Tipo = "Alta",
                Fecha = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc),
                Motivo = "Inicial",
                IdAutor = _adminA
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
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(id));
        return client;
    }

    private static async Task<JsonDocument> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode expectedStatus, bool expectErrors = false)
    {
        Assert.Equal(expectedStatus, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(raw), "La respuesta ProblemDetails no puede estar vacía.");
        var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("status", out var statusProp), $"Falta 'status' en: {raw}");
        Assert.Equal((int)expectedStatus, statusProp.GetInt32());
        Assert.True(root.TryGetProperty("title", out var titleProp) && !string.IsNullOrWhiteSpace(titleProp.GetString()), $"Falta 'title' en: {raw}");
        if (expectErrors)
        {
            Assert.True(root.TryGetProperty("errors", out var errorsProp) && errorsProp.EnumerateObject().Any(),
                $"Se esperaba ValidationProblemDetails con 'errors' no vacío en: {raw}");
        }
        return doc;
    }

    [Fact]
    public async Task ModelStateValidationFilter_EjecutaValidacionesEnControladoresSinRanchScope()
    {
        var anon = Client();

        // AuthController (sin [RanchScope]): correo inválido y contraseña corta deben devolver 400 ValidationProblemDetails
        var badRegister = await anon.PostAsJsonAsync("/api/auth/register", new
        {
            nombre = "A",
            correo = "correo-invalido",
            contrasena = "123"
        });
        using (await AssertProblemAsync(badRegister, HttpStatusCode.BadRequest, expectErrors: true)) { }

        var badLogin = await anon.PostAsJsonAsync("/api/auth/login", new
        {
            correo = "no-es-correo",
            contrasena = "123"
        });
        using (await AssertProblemAsync(badLogin, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // UsuarioController (sin [RanchScope]): actualización de perfil inválida devuelve 400 ValidationProblemDetails
        var adminClient = Client(_adminA);
        var badProfile = await adminClient.PutAsJsonAsync("/api/usuarios/me", new
        {
            nombre = "X",
            correo = "invalido"
        });
        using (await AssertProblemAsync(badProfile, HttpStatusCode.BadRequest, expectErrors: true)) { }
    }

    [Fact]
    public async Task DtoValidations_AlineadasConEsquemaDb_YReglasDeNegocio()
    {
        var client = Client(_adminA);

        // Rancho: nombre > 120 y estado > 20 deben fallar validación DTO (no llegar a BD)
        var badRanch = await client.PostAsJsonAsync("/api/ranchos", new
        {
            nombre = new string('R', 121),
            ubicacionGeneral = "Norte",
            estado = new string('A', 21)
        });
        using (await AssertProblemAsync(badRanch, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // Animal: arete > 50, sexo > 15, estado > 25, fechaNacimiento > fechaIngreso
        var badAnimal = await client.PostAsJsonAsync("/api/animales", new
        {
            idRancho = _ranchA,
            arete = new string('X', 51),
            raza = "Brahman",
            sexo = new string('M', 16),
            fechaNacimiento = "2026-06-10",
            fechaIngreso = "2026-05-01",
            procedencia = "Propio",
            estado = new string('E', 26)
        });
        using (await AssertProblemAsync(badAnimal, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // Alimentacion: XOR(idAnimal, idLote) violado + cantidad <= 0 + fin < inicio
        var badFeeding = await client.PostAsJsonAsync("/api/alimentacion", new
        {
            idAnimal = _animalA,
            idLote = _loteA1,
            alimento = "Concentrado",
            racion = "Base",
            cantidad = 0m,
            unidad = "kg",
            frecuencia = "Diaria",
            inicio = "2026-05-10T10:00:00Z",
            fin = "2026-05-09T10:00:00Z"
        });
        using (await AssertProblemAsync(badFeeding, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // Recordatorio: idAnimal + idLote simultáneos + tipo > 35 + descripcion > 250 + estado > 25
        var badReminder = await client.PostAsJsonAsync("/api/recordatorios", new
        {
            idRancho = _ranchA,
            idAnimal = _animalA,
            idLote = _loteA1,
            tipo = new string('T', 36),
            descripcion = new string('D', 251),
            fechaProgramada = "2026-06-10T09:00:00Z",
            estado = new string('S', 26)
        });
        using (await AssertProblemAsync(badReminder, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // EventoSanitario: tipo > 35
        var badHealth = await client.PostAsJsonAsync("/api/eventos-sanitarios", new
        {
            idAnimal = _animalA,
            tipo = new string('V', 36),
            fecha = "2026-05-05T10:00:00Z",
            responsable = "MVZ"
        });
        using (await AssertProblemAsync(badHealth, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // Tratamiento: dosis <= 0, unidadDosis > 20, viaAdministracion > 60, estado > 25, fechaFin < fechaInicio
        var badTreatment = await client.PostAsJsonAsync("/api/tratamientos", new
        {
            idEventoSanitario = _eventA,
            producto = "Antibiótico",
            dosis = -1m,
            unidadDosis = new string('U', 21),
            viaAdministracion = new string('V', 61),
            frecuencia = "Cada 12h",
            fechaInicio = "2026-05-10T10:00:00Z",
            fechaFin = "2026-05-09T10:00:00Z",
            responsable = "MVZ",
            estado = new string('E', 26)
        });
        using (await AssertProblemAsync(badTreatment, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // MovimientoAnimal: tipo inválido y lotes iguales
        var badMovement = await client.PostAsJsonAsync("/api/movimientos-animales", new
        {
            idAnimal = _animalA,
            idLoteOrigen = _loteA1,
            idLoteDestino = _loteA1,
            tipo = "Invalido",
            fecha = "2026-05-05T10:00:00Z"
        });
        using (await AssertProblemAsync(badMovement, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // Traslado lote: modoLote inválido -> 400 ValidationProblemDetails
        var badTransfer = await client.PostAsJsonAsync("/api/movimientos-animales/traslado-rancho/lote", new
        {
            idLote = _loteA1,
            idRanchoDestino = _ranchA,
            modoLote = "ModoInvalido"
        });
        using (await AssertProblemAsync(badTransfer, HttpStatusCode.BadRequest, expectErrors: true)) { }
    }

    [Fact]
    public async Task RanchScope_BloqueaIdorEnPostIdempotentes_Con403ProblemDetails()
    {
        var attacker = Client(_adminB);

        // Alimentacion ajena con id existente de Rancho A -> 403 ProblemDetails
        var r1 = await attacker.PostAsJsonAsync("/api/alimentacion", new
        {
            idAlimentacion = _alimentacionA,
            idAnimal = _animalB,
            alimento = "Intento",
            racion = "R",
            cantidad = 5m,
            unidad = "kg",
            frecuencia = "Diaria",
            inicio = "2026-05-05T10:00:00Z"
        });
        using (await AssertProblemAsync(r1, HttpStatusCode.Forbidden)) { }

        // Recordatorio ajeno con id existente de Rancho A -> 403 ProblemDetails
        var r2 = await attacker.PostAsJsonAsync("/api/recordatorios", new
        {
            idRecordatorio = _recordatorioA,
            idRancho = _ranchB,
            tipo = "General",
            descripcion = "Intento",
            fechaProgramada = "2026-06-05T10:00:00Z",
            estado = "Pendiente"
        });
        using (await AssertProblemAsync(r2, HttpStatusCode.Forbidden)) { }

        // Movimiento ajeno con id existente de Rancho A -> 403 ProblemDetails
        var r3 = await attacker.PostAsJsonAsync("/api/movimientos-animales", new
        {
            idMovimiento = _movimientoA,
            idAnimal = _animalB,
            tipo = "Alta",
            fecha = "2026-05-05T10:00:00Z"
        });
        using (await AssertProblemAsync(r3, HttpStatusCode.Forbidden)) { }

        // UsuarioRancho ajeno con id existente de Rancho A -> 403 ProblemDetails
        var r4 = await attacker.PostAsJsonAsync("/api/usuario-ranchos", new
        {
            idUsuarioRancho = _usuarioRanchoA,
            idUsuario = _adminB,
            idRancho = _ranchB,
            rol = "Admin",
            estado = "Activo"
        });
        using (await AssertProblemAsync(r4, HttpStatusCode.Forbidden)) { }
    }

    [Fact]
    public async Task IdempotenciaPost_YProteccionPut_YProblemDetailsConsistentes()
    {
        var client = Client(_adminA);

        // 1. POST Animal con fecha calendario y reintento con timestamp mismo día -> 201, luego 200 OK
        var animalId = Guid.NewGuid();
        var createRes = await client.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = animalId,
            idRancho = _ranchA,
            idLote = _loteA1,
            arete = "IDEMP-001",
            raza = "Angus",
            sexo = "Macho",
            fechaNacimiento = "2025-01-15",
            fechaIngreso = "2026-05-15",
            procedencia = "Propio",
            estado = "Activo"
        });
        Assert.Equal(HttpStatusCode.Created, createRes.StatusCode);

        var retrySameDay = await client.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = animalId,
            idRancho = _ranchA,
            idLote = _loteA1,
            arete = "IDEMP-001",
            raza = "Angus",
            sexo = "Macho",
            fechaNacimiento = "2025-01-15T12:30:00Z",
            fechaIngreso = "2026-05-15T18:00:00Z",
            procedencia = "Propio",
            estado = "Activo"
        });
        Assert.Equal(HttpStatusCode.OK, retrySameDay.StatusCode);

        // Reintento con contenido diferente -> 409 Conflict ProblemDetails
        var retryDiff = await client.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = animalId,
            idRancho = _ranchA,
            idLote = _loteA1,
            arete = "IDEMP-001",
            raza = "Charolais",
            sexo = "Macho",
            fechaNacimiento = "2025-01-15",
            fechaIngreso = "2026-05-15",
            procedencia = "Propio",
            estado = "Activo"
        });
        using (await AssertProblemAsync(retryDiff, HttpStatusCode.Conflict)) { }

        // 2. Recordatorio Completado sin FechaCompletado es idempotente al reintentar
        var remId = Guid.NewGuid();
        var remPayload = new
        {
            idRecordatorio = remId,
            idRancho = _ranchA,
            tipo = "General",
            descripcion = "Vacunación anual",
            fechaProgramada = "2026-06-15T10:00:00Z",
            estado = "Completado"
        };
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/recordatorios", remPayload)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/recordatorios", remPayload)).StatusCode);

        // 3. PUT bloquea soft-delete vía EliminadoEn (debe usar DELETE) y cambio de IdRancho en Recordatorio
        var badPutDelete = await client.PutAsJsonAsync($"/api/animales/{animalId}", new
        {
            idRancho = _ranchA,
            idLote = _loteA1,
            arete = "IDEMP-001",
            raza = "Angus",
            sexo = "Macho",
            fechaIngreso = "2026-05-15",
            procedencia = "Propio",
            estado = "Activo",
            eliminadoEn = "2026-05-20T00:00:00Z"
        });
        using (await AssertProblemAsync(badPutDelete, HttpStatusCode.BadRequest, expectErrors: true)) { }

        // 4. DELETE lógico -> PUT posterior devuelve 409 ProblemDetails y POST reintento devuelve 409
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/animales/{animalId}")).StatusCode);

        var putDeleted = await client.PutAsJsonAsync($"/api/animales/{animalId}", new
        {
            idRancho = _ranchA,
            idLote = _loteA1,
            arete = "IDEMP-001",
            raza = "Angus",
            sexo = "Macho",
            fechaIngreso = "2026-05-15",
            procedencia = "Propio",
            estado = "Activo"
        });
        using (await AssertProblemAsync(putDeleted, HttpStatusCode.Conflict)) { }

        var postAfterDelete = await client.PostAsJsonAsync("/api/animales", new
        {
            idAnimal = animalId,
            idRancho = _ranchA,
            idLote = _loteA1,
            arete = "IDEMP-001",
            raza = "Angus",
            sexo = "Macho",
            fechaNacimiento = "2025-01-15",
            fechaIngreso = "2026-05-15",
            procedencia = "Propio",
            estado = "Activo"
        });
        using (await AssertProblemAsync(postAfterDelete, HttpStatusCode.Conflict)) { }

        // 5. GET inexistente -> 404 ProblemDetails
        using (await AssertProblemAsync(await client.GetAsync($"/api/animales/{Guid.NewGuid()}"), HttpStatusCode.NotFound)) { }
    }

    [Fact]
    public async Task MovimientoAnimal_TrasladoExternoYEdicionHistorica_NoCorrompenLoteDelAnimal()
    {
        var client = Client(_adminA);

        // Traslado externo sin idLoteDestino NO debe borrar el lote actual del animal (_loteA1)
        var movId = Guid.NewGuid();
        var createRes = await client.PostAsJsonAsync("/api/movimientos-animales", new
        {
            idMovimiento = movId,
            idAnimal = _animalA,
            idLoteOrigen = _loteA1,
            idLoteDestino = (Guid?)null,
            tipo = "Traslado",
            fecha = "2026-05-10T12:00:00Z",
            destinoExterno = "Feria ganadera",
            motivo = "Exhibición temporal"
        });
        Assert.Equal(HttpStatusCode.Created, createRes.StatusCode);

        var animalAfterTransfer = await client.GetFromJsonAsync<AnimalResponseDto>($"/api/animales/{_animalA}");
        Assert.Equal(_loteA1, animalAfterTransfer!.IdLote);

        // Editar un movimiento histórico vía PUT NO debe sobrescribir el lote actual del animal
        var updateRes = await client.PutAsJsonAsync($"/api/movimientos-animales/{movId}", new
        {
            idAnimal = _animalA,
            idLoteOrigen = _loteA1,
            idLoteDestino = _loteA2,
            tipo = "CambioInterno",
            fecha = "2026-05-10T12:00:00Z",
            motivo = "Corrección histórica de motivo"
        });
        Assert.Equal(HttpStatusCode.NoContent, updateRes.StatusCode);

        var animalAfterHistoryEdit = await client.GetFromJsonAsync<AnimalResponseDto>($"/api/animales/{_animalA}");
        Assert.Equal(_loteA1, animalAfterHistoryEdit!.IdLote);
    }

    [Fact]
    public async Task SwaggerOpenApi_EnTesting_ExponeContratosDtoValidos()
    {
        var client = Client(_adminA);
        var res = await client.GetAsync("/swagger/v1/swagger.json");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var schemas = doc.RootElement.GetProperty("components").GetProperty("schemas");
        Assert.True(schemas.TryGetProperty("AnimalCreateDto", out _));
        Assert.True(schemas.TryGetProperty("AnimalResponseDto", out _));
        Assert.True(schemas.TryGetProperty("TrasladoRanchoResultDto", out _));
        Assert.True(schemas.TryGetProperty("ValidationProblemDetails", out _));
    }

    [Fact]
    public void UtcDateTimeJsonConverter_PreservaFechasCalendarioYNormalizaInstantes()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new UtcDateTimeJsonConverter());
        options.Converters.Add(new NullableUtcDateTimeJsonConverter());

        var calendar = JsonSerializer.Deserialize<DateTime>("\"2026-05-15\"", options);
        Assert.Equal(new DateTime(2026, 5, 15, 0, 0, 0, DateTimeKind.Utc), calendar);
        Assert.Equal("\"2026-05-15T00:00:00.000Z\"", JsonSerializer.Serialize(calendar, options));

        var offset = JsonSerializer.Deserialize<DateTime>("\"2026-05-15T10:00:00-06:00\"", options);
        Assert.Equal(new DateTime(2026, 5, 15, 16, 0, 0, DateTimeKind.Utc), offset);

        var emptyNullable = JsonSerializer.Deserialize<DateTime?>("\"\"", options);
        Assert.Null(emptyNullable);
    }
}
