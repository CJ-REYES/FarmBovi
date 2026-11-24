namespace FarmBovi.Api.Models;

/// <summary>
/// Modelo único compartido entre Pull (Angel - PR #24) y Push/Auditoría (Roberto - PR #23).
/// </summary>
public sealed class CambioServidor
{
    private string? _datos;
    private string? _despues;

    public Guid IdCambio { get; set; } = Guid.NewGuid();
    public Guid IdRancho { get; set; }
    public string Entidad { get; set; } = string.Empty;
    public Guid IdRegistro { get; set; }
    public string Operacion { get; set; } = string.Empty; // "Crear", "Actualizar", "Eliminar"
    public long Version { get; set; }
    public DateTime OcurrioEn { get; set; } = DateTime.UtcNow;
    public Guid? IdUsuario { get; set; }
    public Guid? IdOperacion { get; set; }
    public string Origen { get; set; } = "API"; // "PUSH" o "API"
    public string? Antes { get; set; }

    public string? Despues
    {
        get => _despues ?? _datos;
        set => _despues = value;
    }

    /// <summary>
    /// Instantánea JSON usada por el endpoint Pull de Angel (GET /api/sync/cambios);
    /// null cuando Operacion == "Eliminar".
    /// </summary>
    public string? Datos
    {
        get => _datos ?? (string.Equals(Operacion, "Eliminar", StringComparison.OrdinalIgnoreCase) ? null : _despues);
        set
        {
            _datos = value;
            if (value is not null && _despues is null)
            {
                _despues = value;
            }
        }
    }
}
