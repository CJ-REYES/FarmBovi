using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Storage;

namespace FarmBovi.Api.Data;

public sealed class FarmDbContext(DbContextOptions<FarmDbContext> options) : DbContext(options)
{
    public DbSet<Animal> Animales => Set<Animal>();
    public DbSet<Lote> Lotes => Set<Lote>();
    public DbSet<Rancho> Ranchos => Set<Rancho>();
    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<UsuarioRancho> UsuarioRanchos => Set<UsuarioRancho>();
    public DbSet<MovimientoAnimal> MovimientosAnimales { get; set; }
    public DbSet<Alimentacion> Alimentaciones { get; set; }
    public DbSet<EventoSanitario> EventosSanitarios => Set<EventoSanitario>();
    public DbSet<Tratamiento> Tratamientos => Set<Tratamiento>();
    public DbSet<Recordatorio> Recordatorios => Set<Recordatorio>();
    public DbSet<CambioServidor> CambiosServidor => Set<CambioServidor>();

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        ChangeTracker.DetectChanges();
        var candidates = ChangeTracker.Entries()
            .Where(e => e.Entity is not CambioServidor && e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Select(e => new PendingChange(e.Entity, e.Metadata, e.State, e.State == EntityState.Deleted ? e.Properties.ToDictionary(p => p.Metadata.Name, p => p.OriginalValue) : null,
                TryReadInt(e, "IdRancho")))
            .ToArray();
        if (candidates.Length == 0) return await base.SaveChangesAsync(cancellationToken);

        var trackedEntries = candidates.Select(c => Entry(c.Entity)).ToArray();
        var (ranchByAnimal, ranchByTreatment) = await ResolveRanchesAsync(trackedEntries, cancellationToken);
        IDbContextTransaction? transaction = Database.IsRelational()
            ? await Database.BeginTransactionAsync(cancellationToken)
            : null;
        try
        {
            var saved = await base.SaveChangesAsync(cancellationToken);
            foreach (var change in candidates)
            {
                var entry = Entry(change.Entity);
                var primaryKey = change.Metadata.FindPrimaryKey();
                if (primaryKey is null) continue;
                var keyName = primaryKey.Properties[0].Name;
                var key = change.State == EntityState.Deleted
                    ? change.DeletedValues![keyName]
                    : entry.Property(keyName).CurrentValue;
                var recordId = Convert.ToString(key, System.Globalization.CultureInfo.InvariantCulture);
                if (string.IsNullOrEmpty(recordId)) continue;

                int? ranchId = change.RanchId;
                if (change.Entity is Rancho) ranchId = Convert.ToInt32(key, System.Globalization.CultureInfo.InvariantCulture);
                if (ranchId is null)
                {
                    var animalId = TryReadInt(entry, "IdAnimal");
                    if (animalId is not null && ranchByAnimal.TryGetValue(animalId.Value, out var animalRancho)) ranchId = animalRancho;
                }
                if (ranchId is null && change.Entity is Tratamiento)
                {
                    var eventId = TryReadInt(entry, "IdEventoSanitario");
                    if (eventId is not null && ranchByTreatment.TryGetValue(eventId.Value, out var treatmentRancho)) ranchId = treatmentRancho;
                }
                if (ranchId is null && change.Entity is Usuario) continue;

                CambiosServidor.Add(new CambioServidor
                {
                    Entidad = change.Metadata.ClrType.Name,
                    IdRegistro = recordId,
                    IdRancho = ranchId,
                    Operacion = change.State switch { EntityState.Added => "crear", EntityState.Modified => "actualizar", _ => "eliminar" },
                    OcurrioEn = DateTime.UtcNow,
                    DatosJson = JsonSerializer.Serialize(change.State == EntityState.Deleted ? change.DeletedValues : change.Entity, change.Metadata.ClrType)
                });
            }
            saved += await base.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return saved;
        }
        catch
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            throw;
        }
        finally { if (transaction is not null) await transaction.DisposeAsync(); }
    }

    private sealed record PendingChange(object Entity, Microsoft.EntityFrameworkCore.Metadata.IEntityType Metadata,
        EntityState State, Dictionary<string, object?>? DeletedValues, int? RanchId);

    private async Task<(Dictionary<int, int> Animals, Dictionary<int, int> Treatments)> ResolveRanchesAsync(EntityEntry[] entries, CancellationToken ct)
    {
        var animalIds = new HashSet<int>();
        foreach (var entry in entries)
        {
            if (entry.Entity is EventoSanitario) { var id = TryReadInt(entry, "IdAnimal"); if (id is not null) animalIds.Add(id.Value); }
            if (entry.Entity is MovimientoAnimal or Alimentacion && int.TryParse(TryReadString(entry, "IdAnimal"), out var parsed)) animalIds.Add(parsed);
        }
        var treatmentEventIds = entries.Where(e => e.Entity is Tratamiento).Select(e => TryReadInt(e, "IdEventoSanitario")).Where(id => id is not null).Select(id => id!.Value).Distinct().ToArray();
        if (treatmentEventIds.Length > 0)
        {
            var treatmentAnimalIds = await EventosSanitarios.AsNoTracking().Where(e => treatmentEventIds.Contains(e.IdEventoSanitario)).Select(e => e.IdAnimal).ToListAsync(ct);
            foreach (var id in treatmentAnimalIds) animalIds.Add(id);
        }
        Dictionary<int, int> ranchByAnimal = animalIds.Count == 0 ? new() : await Animales.AsNoTracking().Where(a => animalIds.Contains(a.IdAnimal)).ToDictionaryAsync(a => a.IdAnimal, a => a.IdRancho, ct);
        var ranchByTreatment = treatmentEventIds.Length == 0
            ? new Dictionary<int, int>()
            : await (from e in EventosSanitarios.AsNoTracking()
                     join a in Animales.AsNoTracking() on e.IdAnimal equals a.IdAnimal
                     where treatmentEventIds.Contains(e.IdEventoSanitario)
                     select new { e.IdEventoSanitario, a.IdRancho }).ToDictionaryAsync(x => x.IdEventoSanitario, x => x.IdRancho, ct);
        return (ranchByAnimal, ranchByTreatment);
    }

    private static int? TryReadInt(EntityEntry entry, string property) =>
        entry.Metadata.FindProperty(property) is null ? null : Convert.ToInt32(entry.State == EntityState.Deleted ? entry.Property(property).OriginalValue : entry.Property(property).CurrentValue, System.Globalization.CultureInfo.InvariantCulture);

    private static string? TryReadString(EntityEntry entry, string property) =>
        entry.Metadata.FindProperty(property) is null ? null : Convert.ToString(entry.State == EntityState.Deleted ? entry.Property(property).OriginalValue : entry.Property(property).CurrentValue, System.Globalization.CultureInfo.InvariantCulture);

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CambioServidor>(e =>
        {
            e.ToTable("CambioServidor"); e.HasKey(x => x.IdCambio);
            e.Property(x => x.Entidad).HasMaxLength(80).IsRequired();
            e.Property(x => x.IdRegistro).HasMaxLength(100).IsRequired();
            e.Property(x => x.Operacion).HasMaxLength(20).IsRequired();
            e.Property(x => x.DatosJson).HasColumnType("longtext").IsRequired();
            e.HasIndex(x => new { x.IdRancho, x.IdCambio });
        });
        modelBuilder.Entity<Animal>(e =>
        {
            e.ToTable("Animal"); e.HasKey(x => x.IdAnimal);
            e.Property(x => x.Arete).HasMaxLength(40).IsRequired();
            e.Property(x => x.Raza).HasMaxLength(80).IsRequired();
            e.Property(x => x.Sexo).HasMaxLength(12).IsRequired();
            e.Property(x => x.Procedencia).HasMaxLength(120).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(30).IsRequired();
            e.Property(x => x.Observaciones).HasMaxLength(1000);
            e.HasIndex(x => new { x.IdRancho, x.Arete }).IsUnique();
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Lote>().WithMany().HasForeignKey(x => x.IdLote).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Lote>(e =>
        {
            e.ToTable("Lote"); e.HasKey(x => x.IdLote);
            e.Property(x => x.Nombre).HasMaxLength(100).IsRequired();
            e.Property(x => x.Ubicacion).HasMaxLength(200);
            e.Property(x => x.Estado).HasMaxLength(30).IsRequired();
            e.HasIndex(x => new { x.IdRancho, x.Nombre }).IsUnique();
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Rancho>(e =>
        {
            e.ToTable("Rancho"); e.HasKey(x => x.IdRancho);
            e.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
            e.Property(x => x.UbicacionGeneral).HasMaxLength(250).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(30).IsRequired();
        });

        modelBuilder.Entity<Usuario>(e =>
        {
            e.ToTable("Usuario"); e.HasKey(x => x.Id);
            e.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
            e.Property(x => x.Correo).HasMaxLength(254).IsRequired();
            e.Property(x => x.Contrasena).HasMaxLength(500).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(30).IsRequired();
            e.HasIndex(x => x.Correo).IsUnique();
        });

        modelBuilder.Entity<UsuarioRancho>(e =>
        {
            e.ToTable("UsuarioRancho"); e.HasKey(x => x.IdUsuarioRancho);
            e.Property(x => x.Rol).HasMaxLength(40).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(30).IsRequired();
            e.HasIndex(x => new { x.IdUsuario, x.IdRancho }).IsUnique();
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdUsuario).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<EventoSanitario>(e =>
        {
            e.ToTable("EventoSanitario"); e.HasKey(x => x.IdEventoSanitario);
            e.Property(x => x.Tipo).HasMaxLength(35).IsRequired();
            e.Property(x => x.Sintomas).HasMaxLength(2000);
            e.Property(x => x.Diagnostico).HasMaxLength(2000);
            e.Property(x => x.ProfesionalDiagnostico).HasMaxLength(180);
            e.Property(x => x.EvidenciaDiagnosticoUri).HasMaxLength(500);
            e.Property(x => x.Responsable).HasMaxLength(180).IsRequired();
            e.Property(x => x.Observaciones).HasMaxLength(2000);
            e.HasIndex(x => x.IdAnimal);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdAnimal).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Tratamiento>(e =>
        {
            e.ToTable("Tratamiento"); e.HasKey(x => x.IdTratamiento);
            e.Property(x => x.Producto).HasMaxLength(150).IsRequired();
            e.Property(x => x.Dosis).HasPrecision(10, 3).IsRequired();
            e.Property(x => x.UnidadDosis).HasMaxLength(20).IsRequired();
            e.Property(x => x.ViaAdministracion).HasMaxLength(60);
            e.Property(x => x.Frecuencia).HasMaxLength(80).IsRequired();
            e.Property(x => x.Responsable).HasMaxLength(180).IsRequired();
            e.Property(x => x.PrescripcionUri).HasMaxLength(500);
            e.Property(x => x.Estado).HasMaxLength(25).IsRequired();
            e.HasIndex(x => x.IdEventoSanitario);
            e.HasOne<EventoSanitario>().WithMany().HasForeignKey(x => x.IdEventoSanitario).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Recordatorio>(e =>
        {
            e.ToTable("Recordatorio"); e.HasKey(x => x.IdRecordatorio);
            e.Property(x => x.Tipo).HasMaxLength(35).IsRequired();
            e.Property(x => x.Descripcion).HasMaxLength(250).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(25).IsRequired();
            e.HasIndex(x => x.IdRancho);
            e.HasIndex(x => x.IdAnimal);
            e.HasIndex(x => x.IdLote);
            e.HasIndex(x => x.IdTratamiento);
            e.HasIndex(x => x.IdResponsable);
            e.HasIndex(x => x.FechaProgramada);
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdAnimal).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Lote>().WithMany().HasForeignKey(x => x.IdLote).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Tratamiento>().WithMany().HasForeignKey(x => x.IdTratamiento).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdResponsable).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
