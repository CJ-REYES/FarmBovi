using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace FarmBovi.Api.Services;

public enum GenealogiaOperationStatus
{
    Success,
    BadRequest,
    NotFound,
    Forbidden,
    Conflict
}

public sealed record GenealogiaOperationResult<T>(
    GenealogiaOperationStatus Status,
    T? Data = default,
    string? Error = null);

public sealed class GenealogiaService(FarmDbContext db, RanchAccessService access)
{
    public const int MaxProfundidad = 10;
    public const int MaxObservacionesLength = 500;

    private const string ConcurrencyConflictMessage =
        "El registro de genealogía fue modificado por otro usuario. Recarga los datos e intenta nuevamente.";

    private static readonly HashSet<string> SexosMasculinos = new(StringComparer.OrdinalIgnoreCase)
    {
        "macho", "masculino", "m", "male"
    };

    private static readonly HashSet<string> SexosFemeninos = new(StringComparer.OrdinalIgnoreCase)
    {
        "hembra", "femenino", "h", "f", "female"
    };

    /// <summary>
    /// Valores reconocidos como sexo desconocido/no especificado.
    /// Política explícita del dominio: si el sexo del progenitor es desconocido (null, vacío o marcador
    /// explícito de desconocido), no se inventa el dato ni se bloquea el registro incompleto;
    /// únicamente se rechaza cuando el sexo informado contradice el rol (ej. hembra como padre).
    /// </summary>
    private static readonly HashSet<string> SexosDesconocidos = new(StringComparer.OrdinalIgnoreCase)
    {
        "desconocido", "desconocida", "unknown", "nd", "n/a", "indefinido", "indeterminado", "sin especificar"
    };

    public async Task<GenealogiaOperationResult<GenealogiaRegistroDto>> RegistrarAsync(
        RegistrarGenealogiaRequest request,
        Guid userId,
        CancellationToken ct)
    {
        var (observaciones, obsError) = ValidateAndNormalizeObservaciones(request.Observaciones);
        if (obsError is not null)
            return new(GenealogiaOperationStatus.BadRequest, Error: obsError);

        var validation = await ValidateParentescoAsync(request.IdAnimal, request.IdPadre, request.IdMadre, userId, ct);
        if (validation.Status != GenealogiaOperationStatus.Success)
            return new(validation.Status, Error: validation.Error);

        var existente = await db.GenealogiasAnimales
            .FirstOrDefaultAsync(g => g.IdAnimal == request.IdAnimal, ct);

        if (existente is not null && existente.EliminadoEn is null)
        {
            return new(
                GenealogiaOperationStatus.Conflict,
                Error: "El animal ya tiene un registro de genealogía activo. Use PUT /api/genealogia/{idAnimal} para actualizarlo.");
        }

        var ahora = DateTime.UtcNow;

        if (existente is not null)
        {
            existente.IdPadre = request.IdPadre;
            existente.IdMadre = request.IdMadre;
            existente.Observaciones = observaciones;
            existente.IdAutor = userId;
            existente.EliminadoEn = null;
            existente.VersionRegistro += 1;

            return await SaveChangesWithConflictHandlingAsync(
                () => MapRegistro(existente),
                ConcurrencyConflictMessage,
                ct);
        }

        var nuevo = new GenealogiaAnimal
        {
            IdGenealogia = Guid.NewGuid(),
            IdAnimal = request.IdAnimal,
            IdPadre = request.IdPadre,
            IdMadre = request.IdMadre,
            Observaciones = observaciones,
            IdAutor = userId,
            CreadoEn = ahora,
            VersionRegistro = 1
        };

        db.GenealogiasAnimales.Add(nuevo);
        var saveResult = await SaveChangesWithConflictHandlingAsync(
            () => MapRegistro(nuevo),
            "El animal ya tiene un registro de genealogía activo o está siendo registrado simultáneamente.",
            ct);

        if (saveResult.Status == GenealogiaOperationStatus.Conflict)
            db.Entry(nuevo).State = EntityState.Detached;

        return saveResult;
    }

    public async Task<GenealogiaOperationResult<GenealogiaRegistroDto>> ActualizarAsync(
        Guid idAnimal,
        ActualizarGenealogiaRequest request,
        Guid userId,
        CancellationToken ct)
    {
        var (observaciones, obsError) = ValidateAndNormalizeObservaciones(request.Observaciones);
        if (obsError is not null)
            return new(GenealogiaOperationStatus.BadRequest, Error: obsError);

        var validation = await ValidateParentescoAsync(idAnimal, request.IdPadre, request.IdMadre, userId, ct);
        if (validation.Status != GenealogiaOperationStatus.Success)
            return new(validation.Status, Error: validation.Error);

        var existente = await db.GenealogiasAnimales
            .FirstOrDefaultAsync(g => g.IdAnimal == idAnimal && g.EliminadoEn == null, ct);

        if (existente is null)
            return new(GenealogiaOperationStatus.NotFound, Error: "No existe un registro de genealogía activo para este animal.");

        if (request.VersionRegistro is { } expectedVersion && existente.VersionRegistro != expectedVersion)
            return new(GenealogiaOperationStatus.Conflict, Error: ConcurrencyConflictMessage);

        existente.IdPadre = request.IdPadre;
        existente.IdMadre = request.IdMadre;
        existente.Observaciones = observaciones;
        existente.IdAutor = userId;
        existente.VersionRegistro += 1;

        return await SaveChangesWithConflictHandlingAsync(
            () => MapRegistro(existente),
            ConcurrencyConflictMessage,
            ct);
    }

    public async Task<GenealogiaOperationResult<bool>> EliminarAsync(
        Guid idAnimal,
        Guid userId,
        CancellationToken ct)
    {
        var animal = await db.Animales.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAnimal == idAnimal && a.EliminadoEn == null, ct);

        if (animal is null)
            return new(GenealogiaOperationStatus.NotFound, Error: "El animal especificado no existe.");

        if (!await access.CanAccessAsync(userId, animal.IdRancho, ct))
            return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho de este animal.");

        var registro = await db.GenealogiasAnimales
            .FirstOrDefaultAsync(g => g.IdAnimal == idAnimal && g.EliminadoEn == null, ct);

        if (registro is null)
            return new(GenealogiaOperationStatus.NotFound, Error: "El animal no tiene genealogía activa registrada.");

        registro.EliminadoEn = DateTime.UtcNow;
        registro.IdAutor = userId;
        registro.VersionRegistro += 1;

        return await SaveChangesWithConflictHandlingAsync(
            () => true,
            ConcurrencyConflictMessage,
            ct);
    }

    public async Task<GenealogiaOperationResult<GenealogiaRegistroDto>> ObtenerPorIdAsync(
        Guid idGenealogia,
        Guid userId,
        CancellationToken ct)
    {
        if (idGenealogia == Guid.Empty)
            return new(GenealogiaOperationStatus.BadRequest, Error: "El identificador de genealogía (idGenealogia) es obligatorio.");

        var item = await (
            from g in db.GenealogiasAnimales.AsNoTracking()
            join a in db.Animales.AsNoTracking() on g.IdAnimal equals a.IdAnimal
            where g.IdGenealogia == idGenealogia && g.EliminadoEn == null && a.EliminadoEn == null
            select new { Rel = g, a.IdRancho }
        ).FirstOrDefaultAsync(ct);

        if (item is null)
            return new(GenealogiaOperationStatus.NotFound, Error: "El registro de genealogía especificado no existe.");

        if (!await access.CanAccessAsync(userId, item.IdRancho, ct))
            return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho de este animal.");

        return new(GenealogiaOperationStatus.Success, MapRegistro(item.Rel));
    }

    public async Task<GenealogiaOperationResult<PadresAnimalResponse>> ObtenerPadresAsync(
        Guid idAnimal,
        int profundidad,
        Guid userId,
        CancellationToken ct)
    {
        if (profundidad < 1 || profundidad > MaxProfundidad)
            return new(GenealogiaOperationStatus.BadRequest, Error: $"La profundidad debe estar entre 1 y {MaxProfundidad}.");

        var animal = await db.Animales.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAnimal == idAnimal && a.EliminadoEn == null, ct);

        if (animal is null)
            return new(GenealogiaOperationStatus.NotFound, Error: "El animal especificado no existe.");

        if (!await access.CanAccessAsync(userId, animal.IdRancho, ct))
            return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho de este animal.");

        var activeRanchIds = await access.ActiveRanchIds(userId).ToListAsync(ct);

        AnimalResumenGenealogiaDto? padreDirecto = null;
        AnimalResumenGenealogiaDto? madreDirecta = null;
        string? observacionesDirectas = null;

        var ancestros = new List<AncestroGenealogicoDto>();
        var visited = new HashSet<Guid> { idAnimal };
        var frontier = new List<Guid> { idAnimal };

        for (var gen = 0; gen < profundidad && frontier.Count > 0; gen++)
        {
            var levelRels = await (
                from g in db.GenealogiasAnimales.AsNoTracking()
                join a in db.Animales.AsNoTracking() on g.IdAnimal equals a.IdAnimal
                where g.EliminadoEn == null
                      && a.EliminadoEn == null
                      && activeRanchIds.Contains(a.IdRancho)
                      && frontier.Contains(g.IdAnimal)
                select g
            ).ToListAsync(ct);

            if (levelRels.Count == 0)
                break;

            var parentIds = new HashSet<Guid>();
            foreach (var rel in levelRels)
            {
                if (rel.IdPadre is { } pid) parentIds.Add(pid);
                if (rel.IdMadre is { } mid) parentIds.Add(mid);
            }

            var parentsMap = parentIds.Count == 0
                ? new Dictionary<Guid, Animal>()
                : await db.Animales.AsNoTracking()
                    .Where(a => a.EliminadoEn == null
                                && activeRanchIds.Contains(a.IdRancho)
                                && parentIds.Contains(a.IdAnimal))
                    .ToDictionaryAsync(a => a.IdAnimal, ct);

            var relByChild = levelRels.ToDictionary(r => r.IdAnimal);
            var nextFrontier = new List<Guid>();
            var nextGen = gen + 1;

            foreach (var currentId in frontier)
            {
                if (!relByChild.TryGetValue(currentId, out var rel))
                    continue;

                if (gen == 0 && currentId == idAnimal)
                {
                    observacionesDirectas = rel.Observaciones;
                    if (rel.IdPadre is { } pId && parentsMap.TryGetValue(pId, out var p))
                        padreDirecto = MapResumen(p);
                    if (rel.IdMadre is { } mId && parentsMap.TryGetValue(mId, out var m))
                        madreDirecta = MapResumen(m);
                }

                if (rel.IdPadre is { } nextPadre && parentsMap.TryGetValue(nextPadre, out var padreAnimal))
                {
                    ancestros.Add(new AncestroGenealogicoDto(nextGen, "Padre", currentId, MapResumen(padreAnimal)));
                    if (visited.Add(nextPadre))
                        nextFrontier.Add(nextPadre);
                }

                if (rel.IdMadre is { } nextMadre && parentsMap.TryGetValue(nextMadre, out var madreAnimal))
                {
                    ancestros.Add(new AncestroGenealogicoDto(nextGen, "Madre", currentId, MapResumen(madreAnimal)));
                    if (visited.Add(nextMadre))
                        nextFrontier.Add(nextMadre);
                }
            }

            frontier = nextFrontier;
        }

        var response = new PadresAnimalResponse(
            MapResumen(animal),
            padreDirecto,
            madreDirecta,
            observacionesDirectas,
            ancestros);

        return new(GenealogiaOperationStatus.Success, response);
    }

    /// <summary>
    /// Consulta los descendientes únicos de un animal hasta <paramref name="profundidad"/> generaciones.
    /// <c>TotalDescendientes</c> representa la cantidad de animales descendientes únicos alcanzables
    /// dentro del límite de profundidad solicitado (sin duplicar animales en casos de consanguinidad).
    /// </summary>
    public async Task<GenealogiaOperationResult<DescendientesAnimalResponse>> ObtenerDescendientesAsync(
        Guid idAnimal,
        int profundidad,
        Guid userId,
        CancellationToken ct)
    {
        if (profundidad < 1 || profundidad > MaxProfundidad)
            return new(GenealogiaOperationStatus.BadRequest, Error: $"La profundidad debe estar entre 1 y {MaxProfundidad}.");

        var animal = await db.Animales.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAnimal == idAnimal && a.EliminadoEn == null, ct);

        if (animal is null)
            return new(GenealogiaOperationStatus.NotFound, Error: "El animal especificado no existe.");

        if (!await access.CanAccessAsync(userId, animal.IdRancho, ct))
            return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho de este animal.");

        var activeRanchIds = await access.ActiveRanchIds(userId).ToListAsync(ct);

        var descendientes = new List<DescendienteGenealogicoDto>();
        var visited = new HashSet<Guid> { idAnimal };
        var frontier = new List<Guid> { idAnimal };

        for (var gen = 0; gen < profundidad && frontier.Count > 0; gen++)
        {
            var levelMatches = await (
                from g in db.GenealogiasAnimales.AsNoTracking()
                join a in db.Animales.AsNoTracking() on g.IdAnimal equals a.IdAnimal
                where g.EliminadoEn == null
                      && a.EliminadoEn == null
                      && activeRanchIds.Contains(a.IdRancho)
                      && ((g.IdPadre != null && frontier.Contains(g.IdPadre.Value))
                          || (g.IdMadre != null && frontier.Contains(g.IdMadre.Value)))
                select new { Rel = g, Child = a }
            ).ToListAsync(ct);

            if (levelMatches.Count == 0)
                break;

            var frontierSet = frontier.ToHashSet();
            var nextFrontier = new List<Guid>();
            var nextGen = gen + 1;

            foreach (var match in levelMatches)
            {
                var rel = match.Rel;
                var childAnimal = match.Child;

                string rol;
                Guid directParentId;
                if (rel.IdPadre is { } pid && frontierSet.Contains(pid))
                {
                    rol = "Padre";
                    directParentId = pid;
                }
                else if (rel.IdMadre is { } mid && frontierSet.Contains(mid))
                {
                    rol = "Madre";
                    directParentId = mid;
                }
                else
                {
                    continue;
                }

                // Evitar duplicados cuando un mismo descendiente converge por dos ramas (ej. consanguinidad).
                if (!visited.Add(childAnimal.IdAnimal))
                    continue;

                descendientes.Add(new DescendienteGenealogicoDto(
                    nextGen,
                    rol,
                    directParentId,
                    new AnimalResumenGenealogicoDetalleDto(
                        childAnimal.IdAnimal,
                        childAnimal.IdRancho,
                        childAnimal.Arete,
                        childAnimal.Raza,
                        childAnimal.Sexo,
                        childAnimal.FechaNacimiento,
                        childAnimal.Estado,
                        rel.IdPadre,
                        rel.IdMadre)));

                nextFrontier.Add(childAnimal.IdAnimal);
            }

            frontier = nextFrontier;
        }

        var response = new DescendientesAnimalResponse(
            MapResumen(animal),
            descendientes.Count,
            descendientes);

        return new(GenealogiaOperationStatus.Success, response);
    }

    private async Task<GenealogiaOperationResult<bool>> ValidateParentescoAsync(
        Guid idAnimal,
        Guid? idPadre,
        Guid? idMadre,
        Guid userId,
        CancellationToken ct)
    {
        if (idAnimal == Guid.Empty)
            return new(GenealogiaOperationStatus.BadRequest, Error: "El identificador del animal (idAnimal) es obligatorio.");

        if (idPadre is null && idMadre is null)
            return new(GenealogiaOperationStatus.BadRequest, Error: "Debe especificar al menos un padre (idPadre) o una madre (idMadre).");

        if (idPadre == Guid.Empty || idMadre == Guid.Empty)
            return new(GenealogiaOperationStatus.BadRequest, Error: "Los identificadores de padre y madre no pueden ser GUID vacíos.");

        // Tarea 9: un animal no puede ser su propio padre o madre.
        if (idPadre == idAnimal || idMadre == idAnimal)
            return new(GenealogiaOperationStatus.BadRequest, Error: "Un animal no puede ser su propio padre o madre.");

        if (idPadre is not null && idPadre == idMadre)
            return new(GenealogiaOperationStatus.BadRequest, Error: "El padre y la madre no pueden ser el mismo animal.");

        var animal = await db.Animales.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAnimal == idAnimal && a.EliminadoEn == null, ct);

        if (animal is null)
            return new(GenealogiaOperationStatus.BadRequest, Error: "El animal descendiente especificado no existe o está eliminado.");

        if (!await access.CanAccessAsync(userId, animal.IdRancho, ct))
            return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho del animal descendiente.");

        if (idPadre is { } padreId)
        {
            var padre = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == padreId && a.EliminadoEn == null, ct);
            if (padre is null)
                return new(GenealogiaOperationStatus.BadRequest, Error: "El padre especificado no existe o está eliminado.");

            if (!await access.CanAccessAsync(userId, padre.IdRancho, ct))
                return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho del padre especificado.");

            if (!IsValidFatherSex(padre.Sexo))
                return new(GenealogiaOperationStatus.BadRequest, Error: "El padre especificado debe ser de sexo macho.");

            // Política explícita de fechas: si alguna fecha es desconocida (null), se permite el registro incompleto;
            // cuando ambas existen, el progenitor debe haber nacido estrictamente antes que el descendiente.
            if (animal.FechaNacimiento.HasValue && padre.FechaNacimiento.HasValue &&
                padre.FechaNacimiento.Value.Date >= animal.FechaNacimiento.Value.Date)
            {
                return new(
                    GenealogiaOperationStatus.BadRequest,
                    Error: "La fecha de nacimiento del padre debe ser anterior a la fecha de nacimiento del animal descendiente.");
            }
        }

        if (idMadre is { } madreId)
        {
            var madre = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == madreId && a.EliminadoEn == null, ct);
            if (madre is null)
                return new(GenealogiaOperationStatus.BadRequest, Error: "La madre especificada no existe o está eliminada.");

            if (!await access.CanAccessAsync(userId, madre.IdRancho, ct))
                return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho de la madre especificada.");

            if (!IsValidMotherSex(madre.Sexo))
                return new(GenealogiaOperationStatus.BadRequest, Error: "La madre especificada debe ser de sexo hembra.");

            if (animal.FechaNacimiento.HasValue && madre.FechaNacimiento.HasValue &&
                madre.FechaNacimiento.Value.Date >= animal.FechaNacimiento.Value.Date)
            {
                return new(
                    GenealogiaOperationStatus.BadRequest,
                    Error: "La fecha de nacimiento de la madre debe ser anterior a la fecha de nacimiento del animal descendiente.");
            }
        }

        var activeRanchIds = await access.ActiveRanchIds(userId).ToListAsync(ct);

        // Tarea 10: evitar ciclos genealógicos (idAnimal no puede ser ancestro de idPadre ni de idMadre).
        if (await CreatesCycleAsync(idAnimal, idPadre, idMadre, activeRanchIds, ct))
        {
            return new(
                GenealogiaOperationStatus.BadRequest,
                Error: "La relación solicitada genera un ciclo genealógico: el animal descendiente ya es ancestro de uno de sus progenitores.");
        }

        return new(GenealogiaOperationStatus.Success, true);
    }

    private async Task<bool> CreatesCycleAsync(
        Guid idAnimal,
        Guid? idPadre,
        Guid? idMadre,
        IReadOnlyCollection<Guid> activeRanchIds,
        CancellationToken ct)
    {
        var visited = new HashSet<Guid>();
        var frontier = new List<Guid>();

        if (idPadre is { } p && visited.Add(p))
            frontier.Add(p);
        if (idMadre is { } m && visited.Add(m))
            frontier.Add(m);

        while (frontier.Count > 0)
        {
            if (frontier.Contains(idAnimal))
                return true;

            var levelRels = await (
                from g in db.GenealogiasAnimales.AsNoTracking()
                join a in db.Animales.AsNoTracking() on g.IdAnimal equals a.IdAnimal
                where g.EliminadoEn == null
                      && a.EliminadoEn == null
                      && activeRanchIds.Contains(a.IdRancho)
                      && frontier.Contains(g.IdAnimal)
                select new { g.IdPadre, g.IdMadre }
            ).ToListAsync(ct);

            var nextFrontier = new List<Guid>();
            foreach (var rel in levelRels)
            {
                if (rel.IdPadre is { } nextP)
                {
                    if (nextP == idAnimal)
                        return true;
                    if (visited.Add(nextP))
                        nextFrontier.Add(nextP);
                }

                if (rel.IdMadre is { } nextM)
                {
                    if (nextM == idAnimal)
                        return true;
                    if (visited.Add(nextM))
                        nextFrontier.Add(nextM);
                }
            }

            frontier = nextFrontier;
        }

        return false;
    }

    private static bool IsUnknownSex(string? sexo)
    {
        if (string.IsNullOrWhiteSpace(sexo))
            return true;
        return SexosDesconocidos.Contains(sexo.Trim());
    }

    private static bool IsValidFatherSex(string? sexo)
    {
        if (IsUnknownSex(sexo))
            return true;
        return SexosMasculinos.Contains(sexo!.Trim());
    }

    private static bool IsValidMotherSex(string? sexo)
    {
        if (IsUnknownSex(sexo))
            return true;
        return SexosFemeninos.Contains(sexo!.Trim());
    }

    private static (string? Normalized, string? Error) ValidateAndNormalizeObservaciones(string? observaciones)
    {
        var normalized = string.IsNullOrWhiteSpace(observaciones) ? null : observaciones.Trim();
        if (normalized is not null && normalized.Length > MaxObservacionesLength)
            return (null, $"Las observaciones no pueden exceder {MaxObservacionesLength} caracteres.");

        return (normalized, null);
    }

    private async Task<GenealogiaOperationResult<T>> SaveChangesWithConflictHandlingAsync<T>(
        Func<T> onSuccess,
        string conflictMessage,
        CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return new(GenealogiaOperationStatus.Success, onSuccess());
        }
        catch (DbUpdateConcurrencyException)
        {
            return new(GenealogiaOperationStatus.Conflict, Error: conflictMessage);
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            return new(GenealogiaOperationStatus.Conflict, Error: conflictMessage);
        }
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex)
    {
        if (ex.InnerException is MySqlException mysqlEx && mysqlEx.Number == 1062)
            return true;

        var message = ex.InnerException?.Message ?? ex.Message;
        return message.Contains("Duplicate entry", StringComparison.OrdinalIgnoreCase)
            || message.Contains("UNIQUE constraint failed", StringComparison.OrdinalIgnoreCase);
    }

    private static AnimalResumenGenealogiaDto MapResumen(Animal animal) =>
        new(animal.IdAnimal, animal.IdRancho, animal.Arete, animal.Raza, animal.Sexo, animal.FechaNacimiento, animal.Estado);

    private static GenealogiaRegistroDto MapRegistro(GenealogiaAnimal g) =>
        new(g.IdGenealogia, g.IdAnimal, g.IdPadre, g.IdMadre, g.Observaciones, g.IdAutor, g.CreadoEn, g.VersionRegistro);
}
