using System.Security.Claims;
using FarmBovi.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Services;

/// <summary>
/// Reglas centralizadas de acceso por rancho. Un usuario solo puede consultar o modificar
/// información de ranchos donde tiene una membresía activa (UsuarioRancho activo, sin FechaBaja,
/// usuario activo y rancho no eliminado). Las acciones administrativas requieren un rol administrador.
/// </summary>
public sealed class RanchAccessService(FarmDbContext db)
{
    /// <summary>Roles (comparados en minúsculas) con permisos de administración sobre un rancho.</summary>
    public static readonly string[] AdminRoles = ["admin", "administrador", "propietario"];

    public static Guid? GetUserId(ClaimsPrincipal user)
    {
        var text = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
        return Guid.TryParse(text, out var id) && id != Guid.Empty ? id : null;
    }

    /// <summary>Ranchos donde el usuario tiene una membresía activa.</summary>
    public IQueryable<Guid> ActiveRanchIds(Guid userId) =>
        from ur in db.UsuarioRanchos.AsNoTracking()
        join u in db.Usuarios.AsNoTracking() on ur.IdUsuario equals u.IdUsuario
        join r in db.Ranchos.AsNoTracking() on ur.IdRancho equals r.IdRancho
        where ur.IdUsuario == userId && ur.FechaBaja == null && ur.Estado.ToLower() == "activo" &&
              u.Estado.ToLower() == "activo" && r.EliminadoEn == null
        select ur.IdRancho;

    /// <summary>Ranchos donde el usuario es administrador activo.</summary>
    public IQueryable<Guid> AdminRanchIds(Guid userId) =>
        from ur in db.UsuarioRanchos.AsNoTracking()
        join u in db.Usuarios.AsNoTracking() on ur.IdUsuario equals u.IdUsuario
        join r in db.Ranchos.AsNoTracking() on ur.IdRancho equals r.IdRancho
        where ur.IdUsuario == userId && ur.FechaBaja == null && ur.Estado.ToLower() == "activo" &&
              u.Estado.ToLower() == "activo" && r.EliminadoEn == null &&
              AdminRoles.Contains(ur.Rol.ToLower())
        select ur.IdRancho;

    public Task<bool> CanAccessAsync(Guid userId, Guid ranchId, CancellationToken ct) =>
        ActiveRanchIds(userId).AnyAsync(id => id == ranchId, ct);

    public Task<bool> IsAdminAsync(Guid userId, Guid ranchId, CancellationToken ct) =>
        AdminRanchIds(userId).AnyAsync(id => id == ranchId, ct);

    public Task<bool> IsAdminOfAnyAsync(Guid userId, CancellationToken ct) =>
        AdminRanchIds(userId).AnyAsync(ct);

    /// <summary>Ranchos activos (no dados de baja ni eliminados) a los que pertenece un usuario objetivo.</summary>
    public IQueryable<Guid> MembershipRanchIds(Guid userId) =>
        from ur in db.UsuarioRanchos.AsNoTracking()
        join r in db.Ranchos.AsNoTracking() on ur.IdRancho equals r.IdRancho
        where ur.IdUsuario == userId && ur.FechaBaja == null &&
              ur.Estado.ToLower() == "activo" && r.EliminadoEn == null
        select ur.IdRancho;

    /// <summary>
    /// El usuario <paramref name="adminId"/> puede administrar a <paramref name="targetId"/> únicamente
    /// cuando el objetivo pertenece al menos a un rancho activo y <paramref name="adminId"/> es
    /// administrador de todos los ranchos donde el objetivo tiene membresía.
    /// </summary>
    public async Task<bool> CanManageUserAsync(Guid adminId, Guid targetId, CancellationToken ct)
    {
        var adminRanchIds = await AdminRanchIds(adminId).Distinct().ToListAsync(ct);
        if (adminRanchIds.Count == 0) return false;
        var targetRanchIds = await MembershipRanchIds(targetId).Distinct().ToListAsync(ct);
        if (targetRanchIds.Count == 0) return false;
        return targetRanchIds.All(adminRanchIds.Contains);
    }

    /// <summary>Puede ver a otro usuario si comparte al menos un rancho donde el solicitante es administrador.</summary>
    public async Task<bool> CanViewUserAsync(Guid requesterId, Guid targetId, CancellationToken ct)
    {
        if (requesterId == targetId) return true;
        if (await CanManageUserAsync(requesterId, targetId, ct)) return true;
        var adminRanchIds = AdminRanchIds(requesterId);
        return await MembershipRanchIds(targetId).AnyAsync(id => adminRanchIds.Contains(id), ct);
    }

    // ---- Resolución del rancho propietario de cada recurso ----

    public Task<Guid?> RanchOfRanchAsync(Guid id, CancellationToken ct) =>
        db.Ranchos.AsNoTracking().Where(r => r.IdRancho == id).Select(r => (Guid?)r.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfLoteAsync(Guid id, CancellationToken ct) =>
        db.Lotes.AsNoTracking().Where(l => l.IdLote == id).Select(l => (Guid?)l.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfAnimalAsync(Guid id, CancellationToken ct) =>
        db.Animales.AsNoTracking().Where(a => a.IdAnimal == id).Select(a => (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfEventoSanitarioAsync(Guid id, CancellationToken ct) =>
        (from e in db.EventosSanitarios.AsNoTracking()
         join a in db.Animales.AsNoTracking() on e.IdAnimal equals a.IdAnimal
         where e.IdEventoSanitario == id
         select (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfTratamientoAsync(Guid id, CancellationToken ct) =>
        (from t in db.Tratamientos.AsNoTracking()
         join e in db.EventosSanitarios.AsNoTracking() on t.IdEventoSanitario equals e.IdEventoSanitario
         join a in db.Animales.AsNoTracking() on e.IdAnimal equals a.IdAnimal
         where t.IdTratamiento == id
         select (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfRecordatorioAsync(Guid id, CancellationToken ct) =>
        db.Recordatorios.AsNoTracking().Where(r => r.IdRecordatorio == id).Select(r => (Guid?)r.IdRancho).FirstOrDefaultAsync(ct);

    public async Task<Guid?> RanchOfAlimentacionAsync(Guid id, CancellationToken ct)
    {
        var item = await db.Alimentaciones.AsNoTracking().Where(a => a.IdAlimentacion == id)
            .Select(a => new { a.IdAnimal, a.IdLote }).FirstOrDefaultAsync(ct);
        if (item is null) return null;
        if (item.IdAnimal is { } animalId && await RanchOfAnimalAsync(animalId, ct) is { } r1) return r1;
        if (item.IdLote is { } loteId && await RanchOfLoteAsync(loteId, ct) is { } r2) return r2;
        return Guid.Empty; // existe pero sin rancho resoluble: se trata como no autorizado
    }

    public Task<Guid?> RanchOfMovimientoAsync(Guid id, CancellationToken ct) =>
        (from m in db.MovimientosAnimales.AsNoTracking()
         join a in db.Animales.AsNoTracking() on m.IdAnimal equals a.IdAnimal
         where m.IdMovimiento == id
         select (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfUsuarioRanchoAsync(Guid id, CancellationToken ct) =>
        db.UsuarioRanchos.AsNoTracking().Where(ur => ur.IdUsuarioRancho == id).Select(ur => (Guid?)ur.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfPesajeAsync(Guid id, CancellationToken ct) =>
        (from p in db.Pesajes.AsNoTracking()
         join a in db.Animales.AsNoTracking() on p.IdAnimal equals a.IdAnimal
         where p.IdPesaje == id
         select (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);

    public Task<Guid?> RanchOfEventoReproductivoAsync(Guid id, CancellationToken ct) =>
        (from e in db.EventosReproductivos.AsNoTracking()
         join a in db.Animales.AsNoTracking() on e.IdAnimal equals a.IdAnimal
         where e.IdEventoReproductivo == id
         select (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
}
