using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class RanchoCreateDto
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdRancho { get; set; }

    [Required, NotWhiteSpace, MaxLength(120)]
    public string Nombre { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(250)]
    public string UbicacionGeneral { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Estado { get; set; } = string.Empty;

    [NotEmptyGuid(AllowNull = true)]
    public int? IdAutor { get; set; }
}

public sealed class RanchoUpdateDto
{
    [Required, NotWhiteSpace, MaxLength(120)]
    public string Nombre { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(250)]
    public string UbicacionGeneral { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Estado { get; set; } = string.Empty;

    [NotEmptyGuid(AllowNull = true)]
    public int? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }
}

public sealed class RanchoResponseDto
{
    public Guid IdRancho { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string UbicacionGeneral { get; set; } = string.Empty;
    public string Estado { get; set; } = string.Empty;
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
