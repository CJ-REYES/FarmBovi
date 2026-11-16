using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

var checks = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException($"FALLÓ: {description}");
    checks++;
}

var dbName = Guid.NewGuid().ToString();
var userId = Guid.NewGuid();
var allowedRanchId = Guid.NewGuid();
var forbiddenRanchId = Guid.NewGuid();
var changeDate = new DateTime(2026, 11, 16, 18, 30, 0, DateTimeKind.Utc);
const string signingKey = "FarmBovi-test-signing-key-at-least-32-bytes-long";
var hasher = new PasswordHasher<Usuario>();
var user = new Usuario { IdUsuario = userId, Nombre = "Angel", Correo = "angel@example.com", Estado = "Activo" };
user.Contrasena = hasher.HashPassword(user, "Password123!");

await using (var seedDb = CreateDb(dbName))
{
    seedDb.Usuarios.Add(user);
    seedDb.Ranchos.AddRange(
        new Rancho { IdRancho = allowedRanchId, Nombre = "Rancho autorizado", UbicacionGeneral = "Norte", Estado = "Activo", IdAutor = userId },
        new Rancho { IdRancho = forbiddenRanchId, Nombre = "Rancho ajeno", UbicacionGeneral = "Sur", Estado = "Activo", IdAutor = userId });
    seedDb.UsuarioRanchos.Add(new UsuarioRancho
    {
        IdUsuarioRancho = Guid.NewGuid(), IdUsuario = userId, IdRancho = allowedRanchId,
        Rol = "Admin", Estado = "Activo"
    });
    seedDb.CambiosServidor.AddRange(
        new CambioServidor
        {
            IdCambio = Guid.Parse("00000000-0000-0000-0000-000000000001"), IdRancho = allowedRanchId,
            Entidad = "Animal", IdRegistro = Guid.NewGuid(), Operacion = "Crear", Version = 1,
            OcurrioEn = changeDate, IdUsuario = userId, Datos = "{\"arete\":\"A-1\"}"
        },
        new CambioServidor
        {
            IdCambio = Guid.Parse("00000000-0000-0000-0000-000000000002"), IdRancho = allowedRanchId,
            Entidad = "Animal", IdRegistro = Guid.NewGuid(), Operacion = "Eliminar", Version = 2,
            OcurrioEn = changeDate, IdUsuario = userId
        },
        new CambioServidor
        {
            IdCambio = Guid.NewGuid(), IdRancho = forbiddenRanchId,
            Entidad = "Animal", IdRegistro = Guid.NewGuid(), Operacion = "Crear", Version = 1,
            OcurrioEn = changeDate, Datos = "{\"secreto\":true}"
        });
    await seedDb.SaveChangesAsync();
}

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Jwt:Issuer"] = "FarmBovi.Tests",
    ["Jwt:Audience"] = "FarmBovi.Tests.Client",
    ["Jwt:SigningKey"] = signingKey,
    ["Jwt:TokenMinutes"] = "60"
});
builder.Services.AddDbContext<FarmDbContext>(options => options.UseInMemoryDatabase(dbName));
builder.Services.AddScoped<FarmDomainValidationService>();
builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
builder.Services.AddControllers().AddApplicationPart(typeof(SyncController).Assembly);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true, ValidIssuer = "FarmBovi.Tests",
        ValidateAudience = true, ValidAudience = "FarmBovi.Tests.Client",
        ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
        ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(30), NameClaimType = ClaimTypes.Name
    };
});
builder.Services.AddAuthorization();

await using var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
await app.StartAsync();
try
{
    var address = app.Services.GetRequiredService<IServer>()
        .Features.Get<IServerAddressesFeature>()!.Addresses.Single();
    using var client = new HttpClient { BaseAddress = new Uri(address) };

    var unauthenticatedPull = await client.GetAsync($"api/sync/cambios?idRancho={allowedRanchId}");
    Check(unauthenticatedPull.StatusCode == HttpStatusCode.Unauthorized, "Pull requiere JWT");

    var badLogin = await client.PostAsJsonAsync("api/auth/login", new
    {
        correo = "angel@example.com", contrasena = "incorrecta123"
    });
    Check(badLogin.StatusCode == HttpStatusCode.Unauthorized, "Login rechaza contraseña incorrecta");

    var loginResponse = await client.PostAsJsonAsync("api/auth/login", new
    {
        correo = "ANGEL@example.com", contrasena = "Password123!"
    });
    Check(loginResponse.StatusCode == HttpStatusCode.OK, "Login válido devuelve token");
    var login = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();
    Check(login is not null && login.Ranchos.Count == 1 && login.Ranchos[0].IdRancho == allowedRanchId,
        "Login devuelve únicamente ranchos asignados");
    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login!.Token);

    var forbiddenPull = await client.GetAsync($"api/sync/cambios?idRancho={forbiddenRanchId}");
    Check(forbiddenPull.StatusCode == HttpStatusCode.Forbidden, "Pull rechaza rancho no asignado");

    var firstPage = await client.GetFromJsonAsync<CambiosResponse>(
        $"api/sync/cambios?idRancho={allowedRanchId}&limite=1");
    Check(firstPage is not null && firstPage.Cambios.Count == 1 && firstPage.HayMas &&
          firstPage.Cambios[0].Datos is not null, "Pull entrega primera página y datos");
    var secondPage = await client.GetFromJsonAsync<CambiosResponse>(
        $"api/sync/cambios?idRancho={allowedRanchId}&limite=1&cursor={Uri.EscapeDataString(firstPage!.SiguienteCursor!)}");
    Check(secondPage is not null && secondPage.Cambios.Count == 1 && !secondPage.HayMas &&
          secondPage.Cambios[0].Operacion == "Eliminar" && secondPage.Cambios[0].Datos is null,
        "Pull pagina sin perder eliminaciones");

    var pushId = Guid.NewGuid();
    var animalId = Guid.NewGuid();
    var createPushRequest = new
    {
        idOperacion = pushId,
        idRancho = allowedRanchId,
        idDispositivo = "device-test-1",
        entidad = "Animal",
        idRegistro = animalId,
        operacion = "Crear",
        versionBase = (long?)null,
        datos = new
        {
            arete = "PUSH-001", raza = "Holstein", sexo = "Hembra",
            fechaIngreso = "2026-11-16T00:00:00Z", procedencia = "Prueba", estado = "Activo"
        }
    };
    var pushResponse = await client.PostAsJsonAsync("api/sync/operaciones", createPushRequest);
    Check(pushResponse.StatusCode == HttpStatusCode.Created, "Push crea animal autenticado");
    var pushCreated = await pushResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(pushCreated is not null && pushCreated.Version == 1 && !pushCreated.DuplicadoIgnorado,
        "Push crea versión inicial y devuelve el cambio");
    var changesAfterCreate = await dbCountChanges(dbName, allowedRanchId);
    var duplicateCreateResponse = await client.PostAsJsonAsync("api/sync/operaciones", createPushRequest);
    var duplicateCreate = await duplicateCreateResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(duplicateCreateResponse.StatusCode == HttpStatusCode.OK && duplicateCreate!.DuplicadoIgnorado,
        "Push repetido es idempotente");
    Check(await dbCountChanges(dbName, allowedRanchId) == changesAfterCreate,
        "Reintento Push no duplica CambioServidor");
    var mismatchedRetry = await client.PostAsJsonAsync("api/sync/operaciones", new
    {
        idOperacion = pushId, idRancho = allowedRanchId, idDispositivo = "device-test-1",
        entidad = "Animal", idRegistro = animalId, operacion = "Crear", versionBase = (long?)null,
        datos = new { arete = "PUSH-DIFFERENT", raza = "Holstein", sexo = "Hembra",
            fechaIngreso = "2026-11-16T00:00:00Z", procedencia = "Prueba", estado = "Activo" }
    });
    Check(mismatchedRetry.StatusCode == HttpStatusCode.Conflict,
        "Push rechaza reutilizar idOperacion con contenido distinto");

    var updateOperationId = Guid.NewGuid();
    var updatePayload = new
    {
        idOperacion = updateOperationId, idRancho = allowedRanchId, idDispositivo = "device-test-1",
        entidad = "Animal", idRegistro = animalId, operacion = "Actualizar", versionBase = 1,
        datos = new { estado = "En revisión" }
    };
    var updateResponse = await client.PostAsJsonAsync("api/sync/operaciones", updatePayload);
    var updated = await updateResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(updateResponse.StatusCode == HttpStatusCode.OK && updated!.Version == 2,
        "Push actualiza registro y avanza versión");
    var duplicateUpdateResponse = await client.PostAsJsonAsync("api/sync/operaciones", updatePayload);
    var duplicateUpdate = await duplicateUpdateResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(duplicateUpdateResponse.StatusCode == HttpStatusCode.OK && duplicateUpdate!.DuplicadoIgnorado &&
          await dbCountChanges(dbName, allowedRanchId) == changesAfterCreate + 1,
        "Reintento de actualización no registra un segundo cambio");

    var staleResponse = await client.PostAsJsonAsync("api/sync/operaciones", new
    {
        idOperacion = Guid.NewGuid(), idRancho = allowedRanchId, idDispositivo = "device-2",
        entidad = "Animal", idRegistro = animalId, operacion = "Actualizar", versionBase = 1,
        datos = new { estado = "Cambio antiguo" }
    });
    Check(staleResponse.StatusCode == HttpStatusCode.Conflict, "Push detecta conflicto de versión obsoleta");

    var deleteResponse = await client.PostAsJsonAsync("api/sync/operaciones", new
    {
        idOperacion = Guid.NewGuid(), idRancho = allowedRanchId, idDispositivo = "device-test-1",
        entidad = "Animal", idRegistro = animalId, operacion = "Eliminar", versionBase = 2,
        datos = (object?)null
    });
    var deleted = await deleteResponse.Content.ReadFromJsonAsync<OperacionSyncResponse>();
    Check(deleteResponse.StatusCode == HttpStatusCode.OK && deleted!.Operacion == "Eliminar" &&
          deleted.Version == 3 && deleted.Datos is null,
        "Push elimina con versión correcta y genera tombstone");

    var pullAfterPush = await client.GetFromJsonAsync<CambiosResponse>(
        $"api/sync/cambios?idRancho={allowedRanchId}&limite=100");
    Check(pullAfterPush is not null && pullAfterPush.Cambios.Any(c => c.IdCambio == pushCreated!.IdCambio) &&
          pullAfterPush.Cambios.Any(c => c.IdRegistro == animalId && c.Operacion == "Eliminar"),
        "Pull entrega cambios de Push y la eliminación registrada");

    client.DefaultRequestHeaders.Authorization = null;
    var unauthorizedPush = await client.PostAsJsonAsync("api/sync/operaciones", new { });
    Check(unauthorizedPush.StatusCode == HttpStatusCode.Unauthorized, "Push requiere JWT");

    client.DefaultRequestHeaders.Authorization = null;
    var publicUserList = await client.GetAsync("api/usuarios");
    Check(publicUserList.StatusCode == HttpStatusCode.Unauthorized,
        "Usuario GET requiere autenticación");
    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login!.Token);
    var createUser = await client.PostAsJsonAsync("api/usuarios", new
    {
        nombre = "Usuario de prueba", correo = "NUEVO@example.com",
        contrasena = "Password456!", estado = "Activo"
    });
    Check(createUser.StatusCode == HttpStatusCode.Created, "Usuario POST crea con 201");
    var createdUser = await createUser.Content.ReadFromJsonAsync<UsuarioResponse>();
    Check(createdUser is not null && createdUser.Correo == "nuevo@example.com" &&
          createdUser.IdUsuario != Guid.Empty, "Usuario POST normaliza correo y devuelve identificador");
    var createdJson = await createUser.Content.ReadAsStringAsync();
    Check(!createdJson.Contains("Contrasena", StringComparison.OrdinalIgnoreCase) &&
          !createdJson.Contains("Password456!", StringComparison.Ordinal), "Usuario nunca devuelve contraseña/hash");

    var listUsers = await client.GetFromJsonAsync<List<UsuarioResponse>>("api/usuarios");
    Check(listUsers is not null && listUsers.Count == 2, "Usuario GET lista usuarios");
    var getUser = await client.GetAsync($"api/usuarios/{createdUser!.IdUsuario}");
    Check(getUser.StatusCode == HttpStatusCode.OK, "Usuario GET por id devuelve 200");

    var updateUser = await client.PutAsJsonAsync($"api/usuarios/{createdUser.IdUsuario}", new
    {
        nombre = "Usuario actualizado", correo = "actualizado@example.com", estado = "Activo",
        contrasena = (string?)null
    });
    Check(updateUser.StatusCode == HttpStatusCode.NoContent, "Usuario PUT actualiza con 204");

    var deleteUser = await client.DeleteAsync($"api/usuarios/{createdUser.IdUsuario}");
    Check(deleteUser.StatusCode == HttpStatusCode.NoContent, "Usuario DELETE elimina con 204");
    var deletedUser = await client.GetAsync($"api/usuarios/{createdUser.IdUsuario}");
    Check(deletedUser.StatusCode == HttpStatusCode.NotFound, "Usuario GET retorna 404 después de eliminar");

    Console.WriteLine($"Correcto: {checks} comprobaciones HTTP de Login, JWT, Pull y Usuario CRUD.");
}
finally
{
    await app.StopAsync();
}

static FarmDbContext CreateDb(string name) => new(new DbContextOptionsBuilder<FarmDbContext>()
    .UseInMemoryDatabase(name).Options);

static async Task<int> dbCountChanges(string name, Guid ranchId)
{
    await using var db = CreateDb(name);
    return await db.CambiosServidor.CountAsync(x => x.IdRancho == ranchId);
}
