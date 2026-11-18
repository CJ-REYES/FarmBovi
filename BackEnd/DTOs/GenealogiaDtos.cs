namespace FarmBovi.Api.DTOs;

public sealed record RegistrarGenealogiaRequest(
    Guid IdAnimal,
    Guid? IdPadre,
    Guid? IdMadre,
    string? Observaciones = null);

public sealed record ActualizarGenealogiaRequest(
    Guid? IdPadre,
    Guid? IdMadre,
    string? Observaciones = null);

public sealed record AnimalResumenGenealogiaDto(
    Guid IdAnimal,
    Guid IdRancho,
    string Arete,
    string Raza,
    string Sexo,
    DateTime? FechaNacimiento,
    string Estado);

public sealed record GenealogiaRegistroDto(
    Guid IdGenealogia,
    Guid IdAnimal,
    Guid? IdPadre,
    Guid? IdMadre,
    string? Observaciones,
    Guid IdAutor,
    DateTime CreadoEn,
    long VersionRegistro);

public sealed record PadresAnimalResponse(
    AnimalResumenGenealogiaDto Animal,
    AnimalResumenGenealogiaDto? Padre,
    AnimalResumenGenealogiaDto? Madre,
    string? Observaciones,
    IReadOnlyList<AncestroGenealogicoDto> Ancestros);

public sealed record AncestroGenealogicoDto(
    int Generacion,
    string Vinculo,
    Guid IdHijo,
    AnimalResumenGenealogiaDto Animal);

public sealed record DescendienteGenealogicoDto(
    int Generacion,
    string RolProgenitor,
    Guid IdPadreOMadreDirecto,
    AnimalResumenGenealogicoDetalleDto Descendiente);

public sealed record AnimalResumenGenealogicoDetalleDto(
    Guid IdAnimal,
    Guid IdRancho,
    string Arete,
    string Raza,
    string Sexo,
    DateTime? FechaNacimiento,
    string Estado,
    Guid? IdPadre,
    Guid? IdMadre);

public sealed record DescendientesAnimalResponse(
    AnimalResumenGenealogiaDto Animal,
    int TotalDescendientes,
    IReadOnlyList<DescendienteGenealogicoDto> Descendientes);
