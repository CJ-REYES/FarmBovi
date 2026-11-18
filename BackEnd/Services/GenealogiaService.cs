using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;

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

    public async Task<GenealogiaOperationResult<GenealogiaRegistroDto>> RegistrarAsync(
        RegistrarGenealogiaRequest request,
        Guid userId,
        CancellationToken ct)
    {
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
        var observaciones = NormalizeObservaciones(request.Observaciones);

        if (existente is not null)
        {
            existente.IdPadre = request.IdPadre;
            existente.IdMadre = request.IdMadre;
            existente.Observaciones = observaciones;
            existente.IdAutor = userId;
            existente.EliminadoEn = null;
            existente.VersionRegistro += 1;

            await db.SaveChangesAsync(ct);
            return new(GenealogiaOperationStatus.Success, MapRegistro(existente));
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
        await db.SaveChangesAsync(ct);
        return new(GenealogiaOperationStatus.Success, MapRegistro(nuevo));
    }

    public async Task<GenealogiaOperationResult<GenealogiaRegistroDto>> ActualizarAsync(
        Guid idAnimal,
        ActualizarGenealogiaRequest request,
        Guid userId,
        CancellationToken ct)
    {
        var validation = await ValidateParentescoAsync(idAnimal, request.IdPadre, request.IdMadre, userId, ct);
        if (validation.Status != GenealogiaOperationStatus.Success)
            return new(validation.Status, Error: validation.Error);

        var existente = await db.GenealogiasAnimales
            .FirstOrDefaultAsync(g => g.IdAnimal == idAnimal && g.EliminadoEn == null, ct);

        if (existente is null)
            return new(GenealogiaOperationStatus.NotFound, Error: "No existe un registro de genealogía activo para este animal.");

        existente.IdPadre = request.IdPadre;
        existente.IdMadre = request.IdMadre;
        existente.Observaciones = NormalizeObservaciones(request.Observaciones);
        existente.IdAutor = userId;
        existente.VersionRegistro += 1;

        await db.SaveChangesAsync(ct);
        return new(GenealogiaOperationStatus.Success, MapRegistro(existente));
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
        await db.SaveChangesAsync(ct);

        return new(GenealogiaOperationStatus.Success, true);
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
        var rels = await LoadActiveRelationsByAnimalAsync(ct);
        var animalsMap = await LoadAccessibleAnimalsAsync(activeRanchIds, ct);

        rels.TryGetValue(idAnimal, out var directRel);
        var padre = directRel?.IdPadre is { } pId && animalsMap.TryGetValue(pId, out var p) ? MapResumen(p) : null;
        var madre = directRel?.IdMadre is { } mId && animalsMap.TryGetValue(mId, out var m) ? MapResumen(m) : null;

        var ancestros = new List<AncestroGenealogicoDto>();
        var queue = new Queue<(Guid ChildId, int Gen)>();
        var visited = new HashSet<Guid> { idAnimal };
        queue.Enqueue((idAnimal, 0));

        while (queue.Count > 0)
        {
            var (currentId, gen) = queue.Dequeue();
            if (gen >= profundidad || !rels.TryGetValue(currentId, out var rel))
                continue;

            var nextGen = gen + 1;
            if (rel.IdPadre is { } nextPadre && animalsMap.TryGetValue(nextPadre, out var padreAnimal))
            {
                ancestros.Add(new AncestroGenealogicoDto(nextGen, "Padre", currentId, MapResumen(padreAnimal)));
                if (visited.Add(nextPadre))
                    queue.Enqueue((nextPadre, nextGen));
            }

            if (rel.IdMadre is { } nextMadre && animalsMap.TryGetValue(nextMadre, out var madreAnimal))
            {
                ancestros.Add(new AncestroGenealogicoDto(nextGen, "Madre", currentId, MapResumen(madreAnimal)));
                if (visited.Add(nextMadre))
                    queue.Enqueue((nextMadre, nextGen));
            }
        }

        var response = new PadresAnimalResponse(
            MapResumen(animal),
            padre,
            madre,
            directRel?.Observaciones,
            ancestros);

        return new(GenealogiaOperationStatus.Success, response);
    }

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
        var animalsMap = await LoadAccessibleAnimalsAsync(activeRanchIds, ct);

        var activeRelations = await db.GenealogiasAnimales.AsNoTracking()
            .Where(g => g.EliminadoEn == null)
            .ToListAsync(ct);

        var childrenByParent = new Dictionary<Guid, List<(GenealogiaAnimal Rel, string Rol)>>();
        foreach (var rel in activeRelations)
        {
            if (rel.IdPadre is { } pid)
            {
                if (!childrenByParent.TryGetValue(pid, out var list))
                    childrenByParent[pid] = list = [];
                list.Add((rel, "Padre"));
            }

            if (rel.IdMadre is { } mid)
            {
                if (!childrenByParent.TryGetValue(mid, out var list))
                    childrenByParent[mid] = list = [];
                list.Add((rel, "Madre"));
            }
        }

        var descendientes = new List<DescendienteGenealogicoDto>();
        var visited = new HashSet<Guid> { idAnimal };
        var queue = new Queue<(Guid ParentId, int Gen)>();
        queue.Enqueue((idAnimal, 0));

        while (queue.Count > 0)
        {
            var (currentParentId, gen) = queue.Dequeue();
            if (gen >= profundidad || !childrenByParent.TryGetValue(currentParentId, out var children))
                continue;

            var nextGen = gen + 1;
            foreach (var (rel, rol) in children)
            {
                if (!animalsMap.TryGetValue(rel.IdAnimal, out var childAnimal))
                    continue;

                descendientes.Add(new DescendienteGenealogicoDto(
                    nextGen,
                    rol,
                    currentParentId,
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

                if (visited.Add(rel.IdAnimal))
                    queue.Enqueue((rel.IdAnimal, nextGen));
            }
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
        }

        if (idMadre is { } madreId)
        {
            var madre = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == madreId && a.EliminadoEn == null, ct);
            if (madre is null)
                return new(GenealogiaOperationStatus.BadRequest, Error: "La madre especificada no existe o está eliminada.");

            if (!await access.CanAccessAsync(userId, madre.IdRancho, ct))
                return new(GenealogiaOperationStatus.Forbidden, Error: "No tienes permisos sobre el rancho de la madre especificada.");
        }

        // Tarea 10: evitar ciclos genealógicos (idAnimal no puede ser ancestro de idPadre ni de idMadre).
        if (await CreatesCycleAsync(idAnimal, idPadre, idMadre, ct))
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
        CancellationToken ct)
    {
        var rels = await LoadActiveRelationsByAnimalAsync(ct);
        var queue = new Queue<Guid>();
        var visited = new HashSet<Guid>();

        if (idPadre is { } p && visited.Add(p))
            queue.Enqueue(p);
        if (idMadre is { } m && visited.Add(m))
            queue.Enqueue(m);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (current == idAnimal)
                return true;

            if (!rels.TryGetValue(current, out var rel))
                continue;

            if (rel.IdPadre is { } nextP && visited.Add(nextP))
                queue.Enqueue(nextP);
            if (rel.IdMadre is { } nextM && visited.Add(nextM))
                queue.Enqueue(nextM);
        }

        return false;
    }

    private async Task<Dictionary<Guid, GenealogiaAnimal>> LoadActiveRelationsByAnimalAsync(CancellationToken ct) =>
        await db.GenealogiasAnimales.AsNoTracking()
            .Where(g => g.EliminadoEn == null)
            .ToDictionaryAsync(g => g.IdAnimal, ct);

    private async Task<Dictionary<Guid, Animal>> LoadAccessibleAnimalsAsync(
        IReadOnlyCollection<Guid> activeRanchIds,
        CancellationToken ct) =>
        await db.Animales.AsNoTracking()
            .Where(a => a.EliminadoEn == null && activeRanchIds.Contains(a.IdRancho))
            .ToDictionaryAsync(a => a.IdAnimal, ct);

    private static string? NormalizeObservaciones(string? observaciones) =>
        string.IsNullOrWhiteSpace(observaciones) ? null : observaciones.Trim();

    private static AnimalResumenGenealogiaDto MapResumen(Animal animal) =>
        new(animal.IdAnimal, animal.IdRancho, animal.Arete, animal.Raza, animal.Sexo, animal.FechaNacimiento, animal.Estado);

    private static GenealogiaRegistroDto MapRegistro(GenealogiaAnimal g) =>
        new(g.IdGenealogia, g.IdAnimal, g.IdPadre, g.IdMadre, g.Observaciones, g.IdAutor, g.CreadoEn, g.VersionRegistro);
}
