using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class RanchoCreateDto
{
    public Guid? IdRancho { get; set; }

    [Required, MaxLength(150)]
    public string Nombre { get; set; } = string.Empty;

    [Required, MaxLength(250)]
    public string UbicacionGeneral { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    public Guid IdAutor { get; set; }
}

public sealed class RanchoUpdateDto
{
    [Required, MaxLength(150)]
    public string Nombre { get; set; } = string.Empty;

    [Required, MaxLength(250)]
    public string UbicacionGeneral { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;
}

public sealed class RanchoResponseDto
{
    public Guid IdRancho { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string UbicacionGeneral { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
}
