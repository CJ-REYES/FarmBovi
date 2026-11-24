using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class EventoReproductivoCreateDto
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdEventoReproductivo { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdSemental { get; set; }

    [Required, NotWhiteSpace, MaxLength(60)]
    public string Tipo { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Fecha { get; set; }

    [MaxLength(120)]
    public string? Resultado { get; set; }

    [MaxLength(1000)]
    public string? Observaciones { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public int? IdAutor { get; set; }
}

public sealed class EventoReproductivoUpdateDto
{
    [Required, NotEmptyGuid]
    public Guid IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdSemental { get; set; }

    [Required, NotWhiteSpace, MaxLength(60)]
    public string Tipo { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime Fecha { get; set; }

    [MaxLength(120)]
    public string? Resultado { get; set; }

    [MaxLength(1000)]
    public string? Observaciones { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public int? IdAutor { get; set; }

    [Range(1, long.MaxValue, ErrorMessage = "La versión del registro debe ser mayor que cero.")]
    public long? VersionRegistro { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }
}

public sealed class EventoReproductivoResponseDto
{
    public Guid IdEventoReproductivo { get; set; }
    public Guid IdAnimal { get; set; }
    public Guid? IdSemental { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public DateTime Fecha { get; set; }
    public string? Resultado { get; set; }
    public string? Observaciones { get; set; }
    public int IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
