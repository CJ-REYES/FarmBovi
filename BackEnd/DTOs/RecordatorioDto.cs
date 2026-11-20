using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

public sealed class RecordatorioCreateDto
{
    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdRecordatorio { get; set; }

    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdTratamiento { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdResponsable { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(500)]
    public string Descripcion { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime FechaProgramada { get; set; }

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaCompletado { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }
}

public sealed class RecordatorioUpdateDto
{
    [Required, NotEmptyGuid]
    public Guid IdRancho { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAnimal { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdLote { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdTratamiento { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdResponsable { get; set; }

    [Required, NotWhiteSpace, MaxLength(80)]
    public string Tipo { get; set; } = string.Empty;

    [Required, NotWhiteSpace, MaxLength(500)]
    public string Descripcion { get; set; } = string.Empty;

    [Required, ValidDateRange]
    public DateTime FechaProgramada { get; set; }

    [Required, NotWhiteSpace, MaxLength(40)]
    public string Estado { get; set; } = string.Empty;

    [ValidDateRange(AllowNull = true)]
    public DateTime? FechaCompletado { get; set; }

    [NotEmptyGuid(AllowNull = true)]
    public Guid? IdAutor { get; set; }

    [ValidDateRange(AllowNull = true)]
    public DateTime? EliminadoEn { get; set; }
}

public sealed class RecordatorioResponseDto
{
    public Guid IdRecordatorio { get; set; }
    public Guid IdRancho { get; set; }
    public Guid? IdAnimal { get; set; }
    public Guid? IdLote { get; set; }
    public Guid? IdTratamiento { get; set; }
    public Guid? IdResponsable { get; set; }
    public string Tipo { get; set; } = string.Empty;
    public string Descripcion { get; set; } = string.Empty;
    public DateTime FechaProgramada { get; set; }
    public string Estado { get; set; } = string.Empty;
    public DateTime? FechaCompletado { get; set; }
    public Guid IdAutor { get; set; }
    public DateTime CreadoEn { get; set; }
    public long VersionRegistro { get; set; }
    public DateTime? EliminadoEn { get; set; }
}
