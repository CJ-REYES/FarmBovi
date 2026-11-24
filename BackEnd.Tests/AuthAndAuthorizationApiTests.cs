using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using FarmBovi.Api.Services.Storage;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace FarmBovi.Tests;

/// <summary>
/// Levanta la API real (pipeline completo: autenticación JWT, política global, filtros por rancho)
/// sobre una base en memoria para comprobar respuestas HTTP reales.
/// </summary>
public sealed class FarmBoviApiFactory : WebApplicationFactory<Program>
{
    public const string SigningKey = "FarmBovi-test-signing-key-at-least-32-bytes-long!";
    public const string Issuer = "FarmBovi.Api";
    public const string Audience = "FarmBovi.Clients";
    private readonly string _databaseName = "api-" + Guid.NewGuid().ToString("N");
    private readonly string _tempStorageRoot = Path.Combine(
        Path.GetTempPath(),
        "farmbovi-test-media-" + Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:FarmBovi", "Server=localhost;Database=no_usada;User ID=x;Password=x;");
        builder.UseSetting("Jwt:SigningKey", SigningKey);
        builder.UseSetting("Jwt:Issuer", Issuer);
        builder.UseSetting("Jwt:Audience", Audience);
        builder.UseSetting("MediaStorage:PrivateRootPath", Path.Combine(_tempStorageRoot, "private-media"));
        builder.ConfigureTestServices(services =>
        {
            var toRemove = services.Where(d =>
                d.ServiceType == typeof(DbContextOptions<FarmDbContext>) ||
                d.ServiceType == typeof(DbContextOptions) ||
                d.ServiceType == typeof(FarmDbContext) ||
                d.ServiceType == typeof(ProfilePhotoStorageService) ||
                (d.ServiceType.IsGenericType &&
                 d.ServiceType.GetGenericTypeDefinition().Name.StartsWith("IDbContextOptionsConfiguration"))).ToList();
            foreach (var descriptor in toRemove)
                services.Remove(descriptor);

            services.AddDbContext<FarmDbContext>(options => options
                .UseInMemoryDatabase(_databaseName)
                .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

            // Aisla los archivos de prueba en un directorio temporal para no ensuciar BackEnd/public/imagenes
            services.AddSingleton(new ProfilePhotoStorageService(_tempStorageRoot));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && Directory.Exists(_tempStorageRoot))
        {
            try
            {
                Directory.Delete(_tempStorageRoot, recursive: true);
            }
            catch (IOException)
            {
                // Ignorar si el sistema operativo aún retiene un descriptor
            }
        }
    }

    public async Task SeedAsync(Func<FarmDbContext, Task> seed)
    {
        await using var scope = Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
        await seed(db);
        await db.SaveChangesAsync();
    }

    public static string CreateToken(int userId, DateTime? expires = null, string signingKey = SigningKey,
        string issuer = Issuer, DateTime? notBefore = null)
    {
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), SecurityAlgorithms.HmacSha256);
        var exp = expires ?? DateTime.UtcNow.AddMinutes(30);
        var token = new JwtSecurityToken(issuer, Audience,
        [
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(ClaimTypes.NameIdentifier, userId.ToString())
        ], notBefore ?? exp.AddHours(-1), exp, credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public sealed class AuthAndAuthorizationApiTests : IAsyncLifetime
{
    private static readonly PasswordHasher<Usuario> Hasher = new();
    private const string Password = "ClaveSegura123";

    private readonly FarmBoviApiFactory _factory = new();
    private readonly int _adminA = 1;
    private readonly int _workerA = 2;
    private readonly int _adminB = 3;
    private readonly int _inactive = 4;
    private readonly Guid _ranchA = Guid.NewGuid();
    private readonly Guid _ranchB = Guid.NewGuid();
    private readonly Guid _loteA = Guid.NewGuid();
    private readonly Guid _animalA = Guid.NewGuid();
    private readonly Guid _eventA = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _factory.SeedAsync(db =>
        {
            Usuario User(int id, string name, string estado = "Activo")
            {
                var u = new Usuario { Id = id, Nombre = name, Correo = $"{name.ToLowerInvariant()}@farmbovi.test", Estado = estado };
                u.Contrasena = Hasher.HashPassword(u, Password);
                return u;
            }

            db.Usuarios.AddRange(User(_adminA, "AdminA"), User(_workerA, "WorkerA"), User(_adminB, "AdminB"),
                User(_inactive, "Inactivo", "Inactivo"));
            db.Ranchos.AddRange(
                new Rancho { IdRancho = _ranchA, Nombre = "Rancho A", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = _adminA },
                new Rancho { IdRancho = _ranchB, Nombre = "Rancho B", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = _adminB });
            db.UsuarioRanchos.AddRange(
                new UsuarioRancho { IdUsuario = _adminA, IdRancho = _ranchA, Rol = "Admin", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _workerA, IdRancho = _ranchA, Rol = "Vaquero", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _adminB, IdRancho = _ranchB, Rol = "Admin", Estado = "Activo" },
                new UsuarioRancho { IdUsuario = _inactive, IdRancho = _ranchA, Rol = "Vaquero", Estado = "Activo" });
            db.Lotes.Add(new Lote { IdLote = _loteA, IdRancho = _ranchA, Nombre = "Lote A", Estado = "Activo", IdAutor = _adminA });
            db.Animales.Add(new Animal
            {
                IdAnimal = _animalA, IdRancho = _ranchA, IdLote = _loteA, Arete = "A-001", Raza = "Brahman",
                Sexo = "Hembra", Procedencia = "Propio", Estado = "Activo", IdAutor = _adminA
            });
            db.EventosSanitarios.Add(new EventoSanitario
            {
                IdEventoSanitario = _eventA, IdAnimal = _animalA, Tipo = "Vacuna", Fecha = DateTime.UtcNow,
                Responsable = "MVZ", IdAutor = _adminA
            });
            return Task.CompletedTask;
        });
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private HttpClient Client(int? userId = null)
    {
        var client = _factory.CreateClient();
        if (userId is { } id)
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", FarmBoviApiFactory.CreateToken(id));
        return client;
    }

    // ---------- Login ----------

    [Fact]
    public async Task Login_Correcto_DevuelveTokenUtilizable()
    {
        var client = Client();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { correo = "ADMINA@farmbovi.test", contrasena = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var token = body.RootElement.GetProperty("token").GetString();
        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.Equal(_ranchA, body.RootElement.GetProperty("ranchos")[0].GetProperty("idRancho").GetGuid());

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/animales")).StatusCode);
    }

    [Theory]
    [InlineData("admina@farmbovi.test", "ClaveIncorrecta1")]
    [InlineData("noexiste@farmbovi.test", Password)]
    [InlineData("inactivo@farmbovi.test", Password)]
    public async Task Login_Incorrecto_DesconocidoOInactivo_Devuelve401(string correo, string contrasena)
    {
        var response = await Client().PostAsJsonAsync("/api/auth/login", new { correo, contrasena });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---------- JWT obligatorio ----------

    public static TheoryData<string, string> ProtectedEndpoints => new()
    {
        { "GET", "/api/animales" },
        { "GET", "/api/lotes" },
        { "GET", "/api/ranchos" },
        { "GET", "/api/usuarios" },
        { "GET", "/api/usuario-ranchos" },
        { "GET", "/api/eventos-sanitarios" },
        { "GET", "/api/tratamientos" },
        { "GET", "/api/recordatorios" },
        { "GET", "/api/alimentacion" },
        { "GET", "/api/movimientos-animales" },
        { "GET", "/api/sync/cambios?entidad=cattle" },
        { "POST", "/api/animales" },
        { "POST", "/api/usuarios" },
        { "DELETE", $"/api/ranchos/{Guid.Empty}" }
    };

    [Theory]
    [MemberData(nameof(ProtectedEndpoints))]
    public async Task EndpointsProtegidos_SinJwt_Devuelven401(string method, string url)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        if (method != "GET" && method != "DELETE")
            request.Content = JsonContent.Create(new { });
        var response = await Client().SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Jwt_Invalido_Vencido_OtroEmisor_Devuelven401()
    {
        var tokens = new[]
        {
            "esto-no-es-un-jwt",
            FarmBoviApiFactory.CreateToken(_adminA, signingKey: "otra-clave-de-firma-que-no-es-la-del-servidor!!"),
            FarmBoviApiFactory.CreateToken(_adminA, expires: DateTime.UtcNow.AddMinutes(-5)),
            FarmBoviApiFactory.CreateToken(_adminA, issuer: "Emisor.Falso")
        };

        foreach (var token in tokens)
        {
            var client = _factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/animales")).StatusCode);
        }
    }

    // ---------- Aislamiento por rancho ----------

    [Fact]
    public async Task UsuarioDeOtroRancho_NoPuedeConsultarNiModificar()
    {
        var other = Client(_adminB);

        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/api/animales/{_animalA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/api/lotes/{_loteA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/api/ranchos/{_ranchA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/api/eventos-sanitarios/{_eventA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync($"/api/animales/{_animalA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"/api/lotes/{_loteA}",
            new { idLote = _loteA, idRancho = _ranchB, nombre = "Robado", estado = "Activo" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsJsonAsync("/api/animales", new
        {
            idRancho = _ranchA, idLote = _loteA, arete = "X-1", raza = "X", sexo = "Macho", procedencia = "X", estado = "Activo"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsJsonAsync("/api/eventos-sanitarios", new
        {
            idAnimal = _animalA, tipo = "Vacuna", fecha = DateTime.UtcNow, responsable = "X"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await other.GetAsync($"/api/sync/cambios?entidad=cattle&ranchId={_ranchA}")).StatusCode);

        var animals = await other.GetFromJsonAsync<JsonElement>("/api/animales");
        Assert.Equal(0, animals.GetArrayLength());
        var ranchos = await other.GetFromJsonAsync<JsonElement>("/api/ranchos");
        Assert.All(ranchos.EnumerateArray(), r => Assert.Equal(_ranchB, r.GetProperty("idRancho").GetGuid()));
    }

    [Fact]
    public async Task MiembroDelRancho_ConsultaSusDatos_PeroSoloAdminAdministraRancho()
    {
        var worker = Client(_workerA);
        Assert.Equal(HttpStatusCode.OK, (await worker.GetAsync($"/api/animales/{_animalA}")).StatusCode);
        var animals = await worker.GetFromJsonAsync<JsonElement>("/api/animales");
        Assert.Equal(1, animals.GetArrayLength());

        Assert.Equal(HttpStatusCode.Forbidden, (await worker.DeleteAsync($"/api/ranchos/{_ranchA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await worker.PostAsJsonAsync("/api/usuario-ranchos",
            new { idUsuario = _workerA, idRancho = _ranchA, rol = "Admin", estado = "Activo" })).StatusCode);
    }

    // ---------- Usuarios ----------

    [Fact]
    public async Task Usuarios_PermisosDeAdministracion()
    {
        var worker = Client(_workerA);
        var admin = Client(_adminA);
        var otherAdmin = Client(_adminB);

        // Un usuario sin rol administrador no crea, modifica ni elimina a otros.
        Assert.Equal(HttpStatusCode.Forbidden, (await worker.PostAsJsonAsync("/api/usuarios",
            new { nombre = "Nuevo", correo = "nuevo@farmbovi.test", contrasena = Password, estado = "Activo" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await worker.DeleteAsync($"/api/usuarios/{_adminA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await worker.PutAsJsonAsync($"/api/usuarios/{_adminA}",
            new { nombre = "X", correo = "admina@farmbovi.test", contrasena = "OtraClave123", estado = "Activo" })).StatusCode);

        // Solo ve su propio perfil.
        var visibleToWorker = await worker.GetFromJsonAsync<JsonElement>("/api/usuarios");
        Assert.Equal(_workerA, Assert.Single(visibleToWorker.EnumerateArray()).GetProperty("id").GetInt32());

        // El administrador del rancho A ve a los usuarios de A, pero no a los de B.
        var visibleToAdmin = (await admin.GetFromJsonAsync<JsonElement>("/api/usuarios"))
            .EnumerateArray().Select(u => u.GetProperty("id").GetInt32()).ToList();
        Assert.Contains(_workerA, visibleToAdmin);
        Assert.DoesNotContain(_adminB, visibleToAdmin);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"/api/usuarios/{_adminB}")).StatusCode);

        // Un administrador de otro rancho no puede modificar ni eliminar usuarios de A.
        Assert.Equal(HttpStatusCode.Forbidden, (await otherAdmin.DeleteAsync($"/api/usuarios/{_workerA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherAdmin.PutAsJsonAsync($"/api/usuarios/{_workerA}",
            new { nombre = "X", correo = "workera@farmbovi.test", estado = "Inactivo" })).StatusCode);

        // El administrador de A puede restablecer la contraseña de su trabajador.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync($"/api/usuarios/{_workerA}",
            new { nombre = "WorkerA", correo = "workera@farmbovi.test", contrasena = "NuevaClave123", estado = "Activo" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Client().PostAsJsonAsync("/api/auth/login",
            new { correo = "workera@farmbovi.test", contrasena = "NuevaClave123" })).StatusCode);

        // Nadie puede eliminarse a sí mismo.
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.DeleteAsync($"/api/usuarios/{_adminA}")).StatusCode);
    }

    [Fact]
    public async Task Usuarios_CambioDeContrasenaPropioExigeContrasenaActualYNoCambiaEstado()
    {
        var worker = Client(_workerA);
        Assert.Equal(HttpStatusCode.BadRequest, (await worker.PutAsJsonAsync($"/api/usuarios/{_workerA}",
            new { nombre = "WorkerA", correo = "workera@farmbovi.test", contrasena = "NuevaClave123", estado = "Activo" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await worker.PutAsJsonAsync($"/api/usuarios/{_workerA}",
            new { nombre = "WorkerA", correo = "workera@farmbovi.test", estado = "Inactivo" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await worker.PutAsJsonAsync($"/api/usuarios/{_workerA}",
            new { nombre = "WorkerA", correo = "workera@farmbovi.test", contrasena = "NuevaClave123", contrasenaActual = Password, estado = "Activo" })).StatusCode);
    }
}
