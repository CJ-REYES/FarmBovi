using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class LoteCreateDto
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [Required, NotWhiteSpace, MaxLength(120)]
    public string Nombre { get; set; } = string.Empty;

    [MaxLength(250)]
    public string? Ubicacion { get; set; }

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Estado { get; set; } = string.Empty;

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }
}

public sealed class LoteUpdateDto
{
    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [Required, NotWhiteSpace, MaxLength(120)]
    public string Nombre { get; set; } = string.Empty;

    [MaxLength(250)]
    public string? Ubicacion { get; set; }

    [Required, NotWhiteSpace, MaxLength(20)]
    public string Estado { get; set; } = string.Empty;

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }
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
    public DateTime? EliminadoEn { get; set; }
}
