namespace FarmBovi.Api.Models;

public sealed class UsuarioRancho
{
    public int IdUsuarioRancho { get; set; }
    public int IdUsuario { get; set; }
    public int IdRancho { get; set; }
    public string Rol { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public DateTime FechaAlta { get; set; }
    public DateTime? FechaBaja { get; set; }
}
