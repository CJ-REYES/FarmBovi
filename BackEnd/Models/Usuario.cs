namespace FarmBovi.Api.Models;

public sealed class Usuario
{
    public Guid IdUsuario { get; set; } = Guid.NewGuid();
    public string Nombre { get; set; } = string.Empty;
    public string Correo { get; set; } = string.Empty;
    public string Contrasena { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public string? FotoPerfilRuta { get; set; }
    public string? ConfiguracionJson { get; set; }
    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;
}
