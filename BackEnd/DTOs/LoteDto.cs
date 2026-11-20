using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class LoteCreateDto
{
    public Guid? IdLote { get; set; }

    [Required]
    public Guid IdRancho { get; set; }

    [Required, MaxLength(120)]
    public string Nombre { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Ubicacion { get; set; }

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public Guid IdAutor { get; set; }
}

public sealed class LoteUpdateDto
{
    [Required]
    public Guid IdRancho { get; set; }

    [Required, MaxLength(120)]
    public string Nombre { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Ubicacion { get; set; }

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;
}

public sealed class LoteResponseDto
{
    public Guid IdLote { get; set; }
    public Guid IdRancho { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string? Ubicacion { get; set; }
    public string Estado { get; set; } = string.Empty;
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
}
