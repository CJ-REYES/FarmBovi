using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace FarmBovi.Api.Controllers;

public sealed record LoginRequest([Required, EmailAddress, StringLength(254)] string Correo,
    [Required, StringLength(200, MinimumLength = 8)] string Contrasena);

public sealed record LoginResponse(
    string Token,
    DateTime ExpiraEn,
    int IdUsuario,
    string Nombre,
    IReadOnlyList<LoginRancho> Ranchos,
    string? Correo = null,
    string? FotoPerfilUrl = null,
    UserConfigDto? Configuracion = null);

public sealed record LoginRancho(Guid IdRancho, string Nombre, string Rol);

public sealed record SessionInfoResponse(
    DateTime ExpiraEn,
    int IdUsuario,
    string Nombre,
    IReadOnlyList<LoginRancho> Ranchos,
    string? Correo = null,
    string? FotoPerfilUrl = null,
    UserConfigDto? Configuracion = null);

[ApiController]
[Route("api/auth")]
public sealed class AuthController(
    FarmDbContext db,
    IConfiguration configuration,
    ProfilePhotoStorageService? photoStorage = null) : ControllerBase
{
    public const string AuthCookieName = "farmbovi_auth";
    private static readonly PasswordHasher<Usuario> Hasher = new();

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest input, CancellationToken ct)
    {
        var correo = input.Correo.Trim().ToLowerInvariant();
        var usuario = await db.Usuarios.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Correo.ToLower() == correo, ct);
        if (usuario is null || !usuario.Estado.Equals("Activo", StringComparison.OrdinalIgnoreCase))
            return Unauthorized(new { mensaje = "Correo o contraseña incorrectos." });

        var resultado = Hasher.VerifyHashedPassword(usuario, usuario.Contrasena, input.Contrasena);
        if (resultado == PasswordVerificationResult.Failed)
            return Unauthorized(new { mensaje = "Correo o contraseña incorrectos." });

        var response = await BuildLoginResponseAsync(usuario, ct);
        AppendAuthCookie(response.Token, response.ExpiraEn);
        return Ok(response);
    }

    [HttpGet("session")]
    [Authorize]
    public async Task<ActionResult<SessionInfoResponse>> GetSession(CancellationToken ct)
    {
        var userId = RanchAccessService.GetUserId(User);
        if (userId is null)
            return Unauthorized(new { mensaje = "Sesión no válida o expirada." });

        var usuario = await db.Usuarios.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId.Value && u.Estado.ToLower() == "activo", ct);
        if (usuario is null)
            return Unauthorized(new { mensaje = "La cuenta ya no se encuentra activa." });

        var expClaim = User.FindFirstValue(JwtRegisteredClaimNames.Exp) ?? User.FindFirstValue("exp");
        var expiraEn = long.TryParse(expClaim, out var expSeconds)
            ? DateTimeOffset.FromUnixTimeSeconds(expSeconds).UtcDateTime
            : DateTime.UtcNow.AddMinutes(Math.Clamp(configuration.GetValue("Jwt:TokenMinutes", 60), 5, 1440));

        var ranchos = await LoadActiveRanchesAsync(usuario.Id, ct);
        return Ok(new SessionInfoResponse(
            ExpiraEn: expiraEn,
            IdUsuario: usuario.Id,
            Nombre: usuario.Nombre,
            Ranchos: ranchos,
            Correo: usuario.Correo,
            FotoPerfilUrl: photoStorage is not null
                ? photoStorage.ToPublicUrl(usuario.FotoPerfilRuta)
                : ProfilePhotoStorageService.ToPublicUrlStatic(usuario.FotoPerfilRuta),
            Configuracion: UserConfigDto.ParseOrDefault(usuario.ConfiguracionJson)));
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public IActionResult Logout()
    {
        DeleteAuthCookie();
        return Ok(new { mensaje = "Sesión cerrada correctamente." });
    }

    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Register(RegisterRequest input, CancellationToken ct)
    {
        var nombre = input.Nombre.Trim();
        var correo = input.Correo.Trim().ToLowerInvariant();

        if (nombre.Length < 2)
            return BadRequest(new { mensaje = "El nombre completo debe tener al menos 2 caracteres." });

        var exists = await db.Usuarios.AsNoTracking()
            .AnyAsync(u => u.Correo.ToLower() == correo, ct);
        if (exists)
            return Conflict(new { mensaje = "Ya existe una cuenta registrada con ese correo electrónico." });

        var usuario = new Usuario
        {
            Nombre = nombre,
            Correo = correo,
            Estado = "Activo",
            FotoPerfilRuta = null,
            ConfiguracionJson = UserConfigDto.Default.ToJson(),
            CreadoEn = DateTime.UtcNow
        };
        usuario.Contrasena = Hasher.HashPassword(usuario, input.Contrasena);

        db.Usuarios.Add(usuario);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict(new { mensaje = "Ya existe una cuenta registrada con ese correo electrónico." });
        }

        var response = await BuildLoginResponseAsync(usuario, ct);
        return StatusCode(StatusCodes.Status201Created, response);
    }

    private async Task<LoginResponse> BuildLoginResponseAsync(Usuario usuario, CancellationToken ct)
    {
        var signingKey = configuration["Jwt:SigningKey"];
        var issuer = configuration["Jwt:Issuer"];
        var audience = configuration["Jwt:Audience"];
        if (string.IsNullOrWhiteSpace(signingKey) || Encoding.UTF8.GetByteCount(signingKey) < 32 ||
            string.IsNullOrWhiteSpace(issuer) || string.IsNullOrWhiteSpace(audience))
            throw new InvalidOperationException("Configura Jwt:SigningKey (mínimo 32 bytes), Jwt:Issuer y Jwt:Audience.");

        var now = DateTime.UtcNow;
        var minutes = Math.Clamp(configuration.GetValue("Jwt:TokenMinutes", 60), 5, 1440);
        var expiration = now.AddMinutes(minutes);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, usuario.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, usuario.Id.ToString()),
            new Claim(ClaimTypes.Name, usuario.Nombre),
            new Claim(JwtRegisteredClaimNames.Email, usuario.Correo),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(issuer, audience, claims, now, expiration, credentials);

        var ranchos = await LoadActiveRanchesAsync(usuario.Id, ct);

        return new LoginResponse(
            Token: new JwtSecurityTokenHandler().WriteToken(token),
            ExpiraEn: expiration,
            IdUsuario: usuario.Id,
            Nombre: usuario.Nombre,
            Ranchos: ranchos,
            Correo: usuario.Correo,
            FotoPerfilUrl: photoStorage is not null
                ? photoStorage.ToPublicUrl(usuario.FotoPerfilRuta)
                : ProfilePhotoStorageService.ToPublicUrlStatic(usuario.FotoPerfilRuta),
            Configuracion: UserConfigDto.ParseOrDefault(usuario.ConfiguracionJson));
    }

    private Task<List<LoginRancho>> LoadActiveRanchesAsync(int userId, CancellationToken ct) =>
        (from ur in db.UsuarioRanchos.AsNoTracking()
         join r in db.Ranchos.AsNoTracking() on ur.IdRancho equals r.IdRancho
         where ur.IdUsuario == userId && ur.FechaBaja == null &&
               ur.Estado.ToLower() == "activo" && r.EliminadoEn == null
         orderby r.Nombre
         select new LoginRancho(r.IdRancho, r.Nombre, ur.Rol)).ToListAsync(ct);

    private CookieOptions BuildAuthCookieOptions(DateTimeOffset? expires = null) =>
        new()
        {
            HttpOnly = true,
            Secure = Request?.IsHttps ?? false,
            SameSite = SameSiteMode.Lax,
            Path = "/api",
            IsEssential = true,
            Expires = expires
        };

    private void AppendAuthCookie(string token, DateTime expirationUtc)
    {
        if (Response is null) return;
        Response.Cookies.Append(
            AuthCookieName,
            token,
            BuildAuthCookieOptions(new DateTimeOffset(DateTime.SpecifyKind(expirationUtc, DateTimeKind.Utc))));
    }

    private void DeleteAuthCookie()
    {
        if (Response is null) return;
        Response.Cookies.Delete(AuthCookieName, BuildAuthCookieOptions());
    }
}
