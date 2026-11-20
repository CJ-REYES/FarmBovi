using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class UsuarioRanchoCreateDto
{
    public Guid? IdUsuarioRancho { get; set; }

    [Required]
    public Guid IdUsuario { get; set; }

    [Required]
    public Guid IdRancho { get; set; }

    [Required, MaxLength(40)]
    public string Rol { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public DateTime? FechaAlta { get; set; }
    public DateTime? FechaBaja { get; set; }
}

public sealed class UsuarioRanchoUpdateDto
{
    [Required]
    public Guid IdUsuario { get; set; }

    [Required]
    public Guid IdRancho { get; set; }

    [Required, MaxLength(40)]
    public string Rol { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public DateTime? FechaAlta { get; set; }
    public DateTime? FechaBaja { get; set; }
}

public sealed class UsuarioRanchoResponseDto
{
    public Guid IdUsuarioRancho { get; set; }
    public Guid IdUsuario { get; set; }
    public Guid IdRancho { get; set; }
    public string Rol { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public DateTime FechaAlta { get; set; }
    public DateTime? FechaBaja { get; set; }
}
