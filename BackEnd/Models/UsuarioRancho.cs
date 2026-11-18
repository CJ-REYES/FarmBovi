namespace FarmBovi.Api.Models;

public sealed class UsuarioRancho
{
    public Guid IdUsuarioRancho { get; set; } = Guid.NewGuid();
    public int IdUsuario { get; set; } // <-- Cambiado de Guid a int
    public Guid IdRancho { get; set; }
    public string Rol { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public DateTime FechaAlta { get; set; } = DateTime.UtcNow;
    public DateTime? FechaBaja { get; set; }
}