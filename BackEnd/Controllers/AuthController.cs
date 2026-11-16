using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace FarmBovi.Api.Controllers;

public sealed record LoginRequest([Required, EmailAddress, StringLength(254)] string Correo,
    [Required, StringLength(200, MinimumLength = 8)] string Contrasena);

public sealed record LoginResponse(string Token, DateTime ExpiraEn, Guid IdUsuario, string Nombre,
    IReadOnlyList<LoginRancho> Ranchos);

public sealed record LoginRancho(Guid IdRancho, string Nombre, string Rol);

[ApiController]
[Route("api/auth")]
public sealed class AuthController(FarmDbContext db, IConfiguration configuration) : ControllerBase
{
    private static readonly PasswordHasher<Usuario> Hasher = new();

    [HttpPost("login")]
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
            new Claim(JwtRegisteredClaimNames.Sub, usuario.IdUsuario.ToString()),
            new Claim(ClaimTypes.NameIdentifier, usuario.IdUsuario.ToString()),
            new Claim(ClaimTypes.Name, usuario.Nombre),
            new Claim(JwtRegisteredClaimNames.Email, usuario.Correo),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(issuer, audience, claims, now, expiration, credentials);
        var ranchos = await (from ur in db.UsuarioRanchos.AsNoTracking()
                             join r in db.Ranchos.AsNoTracking() on ur.IdRancho equals r.IdRancho
                             where ur.IdUsuario == usuario.IdUsuario && ur.FechaBaja == null &&
                                   ur.Estado.ToLower() == "activo" && r.EliminadoEn == null
                             orderby r.Nombre
                             select new LoginRancho(r.IdRancho, r.Nombre, ur.Rol)).ToListAsync(ct);

        return Ok(new LoginResponse(new JwtSecurityTokenHandler().WriteToken(token), expiration,
            usuario.IdUsuario, usuario.Nombre, ranchos));
    }
}
