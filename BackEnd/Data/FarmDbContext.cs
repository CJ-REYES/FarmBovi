using System.Security.Claims;
using System.Text.Json;
using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace FarmBovi.Api.Data;

public sealed record PushTraceMetadata(
    Guid IdCambio,
    Guid IdOperacion,
    Guid IdUsuario,
    Guid IdRancho,
    string Entidad,
    Guid IdRegistro,
    string Operacion,
    long Version,
    string? AntesJson,
    string? DespuesJson,
    string? DatosPullJson,
    DateTime OcurrioEn);

public sealed class FarmDbContext(
    DbContextOptions<FarmDbContext> options,
    IHttpContextAccessor? httpContextAccessor = null) : DbContext(options)
{
    private static readonly JsonSerializerOptions TraceJsonOptions = new(JsonSerializerDefaults.Web);

    private PushTraceMetadata? _pendingPushMetadata;
    private bool _preparingServerChanges;

    public DbSet<Animal> Animales => Set<Animal>();
    public DbSet<GenealogiaAnimal> GenealogiasAnimales => Set<GenealogiaAnimal>();
    public DbSet<Lote> Lotes => Set<Lote>();
    public DbSet<Rancho> Ranchos => Set<Rancho>();
    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<UsuarioRancho> UsuarioRanchos => Set<UsuarioRancho>();
    public DbSet<MovimientoAnimal> MovimientosAnimales => Set<MovimientoAnimal>();
    public DbSet<Alimentacion> Alimentaciones => Set<Alimentacion>();
    public DbSet<EventoSanitario> EventosSanitarios => Set<EventoSanitario>();
    public DbSet<Tratamiento> Tratamientos => Set<Tratamiento>();
    public DbSet<Recordatorio> Recordatorios => Set<Recordatorio>();
    public DbSet<RegistroSyncServidor> RegistrosSyncServidor => Set<RegistroSyncServidor>();
    public DbSet<CambioServidor> CambiosServidor => Set<CambioServidor>();

    public void SetPendingPushMetadata(PushTraceMetadata metadata) =>
        _pendingPushMetadata = metadata;

    public void ClearPendingPushMetadata() =>
        _pendingPushMetadata = null;

    public override int SaveChanges() =>
        SaveChanges(acceptAllChangesOnSuccess: true);

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        if (_preparingServerChanges)
            return base.SaveChanges(acceptAllChangesOnSuccess);

        _preparingServerChanges = true;
        try
        {
            PrepareChangesSync();
            return base.SaveChanges(acceptAllChangesOnSuccess);
        }
        finally
        {
            _preparingServerChanges = false;
        }
    }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) =>
        await SaveChangesAsync(acceptAllChangesOnSuccess: true, cancellationToken);

    public override async Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        if (_preparingServerChanges)
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);

        _preparingServerChanges = true;
        try
        {
            await PrepareChangesAsync(cancellationToken);
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
        finally
        {
            _preparingServerChanges = false;
        }
    }

    private void PrepareChangesSync()
    {
        ChangeTracker.DetectChanges();

        if (TryEnqueuePendingPushMetadata())
            return;

        var apiEntries = GetSynchronizableEntries();
        if (apiEntries.Count == 0) return;

        var ahora = DateTime.UtcNow;
        foreach (var entry in apiEntries)
        {
            var idRancho = ResolveEntityRanchoIdSync(entry);
            EnqueueApiChangeRecord(entry, idRancho, ahora);
        }
    }

    private async Task PrepareChangesAsync(CancellationToken ct)
    {
        ChangeTracker.DetectChanges();

        if (TryEnqueuePendingPushMetadata())
            return;

        var apiEntries = GetSynchronizableEntries();
        if (apiEntries.Count == 0) return;

        var ahora = DateTime.UtcNow;
        foreach (var entry in apiEntries)
        {
            var idRancho = await ResolveEntityRanchoIdAsync(entry, ct);
            EnqueueApiChangeRecord(entry, idRancho, ahora);
        }
    }

    private bool TryEnqueuePendingPushMetadata()
    {
        if (_pendingPushMetadata is not { } pushMeta)
            return false;

        _pendingPushMetadata = null;
        CambiosServidor.Add(new CambioServidor
        {
            IdCambio = pushMeta.IdCambio,
            IdRancho = pushMeta.IdRancho,
            Entidad = pushMeta.Entidad,
            IdRegistro = pushMeta.IdRegistro,
            Operacion = pushMeta.Operacion,
            Version = pushMeta.Version,
            OcurrioEn = pushMeta.OcurrioEn,
            IdUsuario = pushMeta.IdUsuario,
            IdOperacion = pushMeta.IdOperacion,
            Origen = "PUSH",
            Antes = pushMeta.AntesJson,
            Despues = pushMeta.DespuesJson,
            Datos = pushMeta.DatosPullJson
        });

        return true;
    }

    private List<EntityEntry> GetSynchronizableEntries() =>
        ChangeTracker.Entries()
            .Where(e => IsSynchronizableEntity(e.Entity)
                     && e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .ToList();

    private void EnqueueApiChangeRecord(EntityEntry entry, Guid idRancho, DateTime ahora)
    {
        var cambio = BuildApiChangeRecord(entry, idRancho, ahora);
        if (cambio is null) return;

        var alreadyTracked = ChangeTracker.Entries<CambioServidor>().Any(e =>
            e.Entity.IdRancho == cambio.IdRancho &&
            e.Entity.Entidad == cambio.Entidad &&
            e.Entity.IdRegistro == cambio.IdRegistro &&
            e.Entity.Version == cambio.Version);

        if (!alreadyTracked)
        {
            CambiosServidor.Add(cambio);
        }
    }

    private static bool IsSynchronizableEntity(object entity) =>
        entity is Animal or Lote or Rancho or Alimentacion or MovimientoAnimal
            or EventoSanitario or Tratamiento or Recordatorio;

    private CambioServidor? BuildApiChangeRecord(EntityEntry entry, Guid idRancho, DateTime ahora)
    {
        if (idRancho == Guid.Empty) return null;

        var primaryKey = entry.Metadata.FindPrimaryKey();
        if (primaryKey is null) return null;

        var keyProp = primaryKey.Properties[0].Name;
        var keyVal = entry.State == EntityState.Deleted
            ? entry.Property(keyProp).OriginalValue
            : entry.Property(keyProp).CurrentValue;

        if (keyVal is not Guid idRegistro || idRegistro == Guid.Empty) return null;

        var userIdText = httpContextAccessor?.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? httpContextAccessor?.HttpContext?.User.FindFirstValue("sub");
        Guid? idUsuario = Guid.TryParse(userIdText, out var parsedUser) && parsedUser != Guid.Empty
            ? parsedUser
            : TryGetGuidProperty(entry, "IdAutor") is var autor && autor != Guid.Empty ? autor : null;

        var version = TryGetLongProperty(entry, "VersionRegistro") ?? 1L;
        var wasSoftDeleted = entry.State == EntityState.Modified
            && entry.Properties.Any(p => p.Metadata.Name == "EliminadoEn")
            && entry.Property("EliminadoEn").OriginalValue is null
            && entry.Property("EliminadoEn").CurrentValue is not null;

        var operacion = entry.State switch
        {
            EntityState.Added => "Crear",
            EntityState.Deleted => "Eliminar",
            _ when wasSoftDeleted => "Eliminar",
            _ => "Actualizar"
        };

        string? antesJson = null;
        if (entry.State is EntityState.Modified or EntityState.Deleted)
        {
            var originalDict = entry.Properties.ToDictionary(
                p => JsonNamingPolicy.CamelCase.ConvertName(p.Metadata.Name),
                p => p.OriginalValue);
            antesJson = JsonSerializer.Serialize(originalDict, TraceJsonOptions);
        }

        var despuesJson = entry.State == EntityState.Deleted
            ? null
            : JsonSerializer.Serialize(entry.Entity, entry.Metadata.ClrType, TraceJsonOptions);

        return new CambioServidor
        {
            IdCambio = Guid.NewGuid(),
            IdRancho = idRancho,
            Entidad = entry.Metadata.ClrType.Name,
            IdRegistro = idRegistro,
            Operacion = operacion,
            Version = version,
            OcurrioEn = ahora,
            IdUsuario = idUsuario,
            IdOperacion = null,
            Origen = "API",
            Antes = antesJson,
            Despues = despuesJson,
            Datos = operacion == "Eliminar" ? null : despuesJson
        };
    }

    private static Guid TryGetGuidProperty(EntityEntry entry, string propName)
    {
        var prop = entry.Metadata.FindProperty(propName);
        if (prop is null) return Guid.Empty;
        var val = entry.State == EntityState.Deleted
            ? entry.Property(propName).OriginalValue
            : entry.Property(propName).CurrentValue;
        return val is Guid g ? g : Guid.Empty;
    }

    private static long? TryGetLongProperty(EntityEntry entry, string propName)
    {
        var prop = entry.Metadata.FindProperty(propName);
        if (prop is null) return null;
        var val = entry.Property(propName).CurrentValue;
        return val is long l ? l : null;
    }

    private Guid ResolveEntityRanchoIdSync(EntityEntry entry)
    {
        if (entry.Entity is Rancho r) return r.IdRancho;

        var directRancho = TryGetGuidProperty(entry, "IdRancho");
        if (directRancho != Guid.Empty) return directRancho;

        var idAnimal = TryGetGuidProperty(entry, "IdAnimal");
        if (idAnimal != Guid.Empty)
        {
            var localAnimal = Animales.Local.FirstOrDefault(a => a.IdAnimal == idAnimal);
            if (localAnimal is not null) return localAnimal.IdRancho;

            var dbRancho = Animales.AsNoTracking()
                .Where(a => a.IdAnimal == idAnimal)
                .Select(a => a.IdRancho)
                .FirstOrDefault();
            if (dbRancho != Guid.Empty) return dbRancho;
        }

        var idLote = TryGetGuidProperty(entry, "IdLote");
        if (idLote != Guid.Empty)
        {
            var localLote = Lotes.Local.FirstOrDefault(l => l.IdLote == idLote);
            if (localLote is not null) return localLote.IdRancho;

            var dbRancho = Lotes.AsNoTracking()
                .Where(l => l.IdLote == idLote)
                .Select(l => l.IdRancho)
                .FirstOrDefault();
            if (dbRancho != Guid.Empty) return dbRancho;
        }

        var idEvento = TryGetGuidProperty(entry, "IdEventoSanitario");
        if (idEvento != Guid.Empty)
        {
            var evAnimalId = EventosSanitarios.Local.FirstOrDefault(e => e.IdEventoSanitario == idEvento)?.IdAnimal
                ?? EventosSanitarios.AsNoTracking()
                    .Where(e => e.IdEventoSanitario == idEvento)
                    .Select(e => e.IdAnimal)
                    .FirstOrDefault();

            if (evAnimalId != Guid.Empty)
            {
                var localAnimal = Animales.Local.FirstOrDefault(a => a.IdAnimal == evAnimalId);
                if (localAnimal is not null) return localAnimal.IdRancho;

                return Animales.AsNoTracking()
                    .Where(a => a.IdAnimal == evAnimalId)
                    .Select(a => a.IdRancho)
                    .FirstOrDefault();
            }
        }

        return Guid.Empty;
    }

    private async Task<Guid> ResolveEntityRanchoIdAsync(EntityEntry entry, CancellationToken ct)
    {
        if (entry.Entity is Rancho r) return r.IdRancho;

        var directRancho = TryGetGuidProperty(entry, "IdRancho");
        if (directRancho != Guid.Empty) return directRancho;

        var idAnimal = TryGetGuidProperty(entry, "IdAnimal");
        if (idAnimal != Guid.Empty)
        {
            var localAnimal = Animales.Local.FirstOrDefault(a => a.IdAnimal == idAnimal);
            if (localAnimal is not null) return localAnimal.IdRancho;

            var dbRancho = await Animales.AsNoTracking()
                .Where(a => a.IdAnimal == idAnimal)
                .Select(a => a.IdRancho)
                .FirstOrDefaultAsync(ct);
            if (dbRancho != Guid.Empty) return dbRancho;
        }

        var idLote = TryGetGuidProperty(entry, "IdLote");
        if (idLote != Guid.Empty)
        {
            var localLote = Lotes.Local.FirstOrDefault(l => l.IdLote == idLote);
            if (localLote is not null) return localLote.IdRancho;

            var dbRancho = await Lotes.AsNoTracking()
                .Where(l => l.IdLote == idLote)
                .Select(l => l.IdRancho)
                .FirstOrDefaultAsync(ct);
            if (dbRancho != Guid.Empty) return dbRancho;
        }

        var idEvento = TryGetGuidProperty(entry, "IdEventoSanitario");
        if (idEvento != Guid.Empty)
        {
            var evAnimalId = EventosSanitarios.Local.FirstOrDefault(e => e.IdEventoSanitario == idEvento)?.IdAnimal
                ?? await EventosSanitarios.AsNoTracking()
                    .Where(e => e.IdEventoSanitario == idEvento)
                    .Select(e => e.IdAnimal)
                    .FirstOrDefaultAsync(ct);

            if (evAnimalId != Guid.Empty)
            {
                var localAnimal = Animales.Local.FirstOrDefault(a => a.IdAnimal == evAnimalId);
                if (localAnimal is not null) return localAnimal.IdRancho;

                return await Animales.AsNoTracking()
                    .Where(a => a.IdAnimal == evAnimalId)
                    .Select(a => a.IdRancho)
                    .FirstOrDefaultAsync(ct);
            }
        }

        return Guid.Empty;
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Usuario>(e =>
        {
            e.ToTable("Usuario");
            e.HasKey(x => x.IdUsuario);
            e.Property(x => x.IdUsuario).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
            e.Property(x => x.Correo).HasMaxLength(254).IsRequired();
            e.Property(x => x.Contrasena).HasMaxLength(500).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(20).IsRequired();
            e.Property(x => x.CreadoEn).IsRequired();
            e.HasIndex(x => x.Correo).IsUnique();
        });

        modelBuilder.Entity<Rancho>(e =>
        {
            e.ToTable("Rancho");
            e.HasKey(x => x.IdRancho);
            e.Property(x => x.IdRancho).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
            e.Property(x => x.UbicacionGeneral).HasMaxLength(250).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(20).IsRequired();
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<UsuarioRancho>(e =>
        {
            e.ToTable("UsuarioRancho");
            e.HasKey(x => x.IdUsuarioRancho);
            e.Property(x => x.IdUsuarioRancho).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdUsuario).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdRancho).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.Rol).HasMaxLength(30).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(20).IsRequired();
            e.HasIndex(x => new { x.IdUsuario, x.IdRancho }).IsUnique();
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdUsuario).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Lote>(e =>
        {
            e.ToTable("Lote");
            e.HasKey(x => x.IdLote);
            e.Property(x => x.IdLote).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdRancho).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
            e.Property(x => x.Ubicacion).HasMaxLength(250);
            e.Property(x => x.Estado).HasMaxLength(20).IsRequired();
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasIndex(x => new { x.IdRancho, x.Nombre }).IsUnique();
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Animal>(e =>
        {
            e.ToTable("Animal");
            e.HasKey(x => x.IdAnimal);
            e.Property(x => x.IdAnimal).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdRancho).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdLote).HasColumnType("char(36)");
            e.Property(x => x.Arete).HasMaxLength(50).IsRequired();
            e.Property(x => x.Raza).HasMaxLength(80).IsRequired();
            e.Property(x => x.Sexo).HasMaxLength(15).IsRequired();
            e.Property(x => x.FechaNacimiento).HasColumnType("date");
            e.Property(x => x.FechaIngreso).HasColumnType("date").IsRequired();
            e.Property(x => x.Procedencia).HasMaxLength(250).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(25).IsRequired();
            e.Property(x => x.FechaSalida).HasColumnType("date");
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasIndex(x => new { x.IdRancho, x.Arete }).IsUnique();
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Lote>().WithMany().HasForeignKey(x => x.IdLote).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Alimentacion>(e =>
        {
            e.ToTable("Alimentacion");
            e.HasKey(x => x.IdAlimentacion);
            e.Property(x => x.IdAlimentacion).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdAnimal).HasColumnType("char(36)");
            e.Property(x => x.IdLote).HasColumnType("char(36)");
            e.Property(x => x.Alimento).HasMaxLength(150).IsRequired();
            e.Property(x => x.Racion).HasMaxLength(150).IsRequired();
            e.Property(x => x.Cantidad).HasPrecision(10, 3).IsRequired();
            e.Property(x => x.Unidad).HasMaxLength(20).IsRequired();
            e.Property(x => x.Frecuencia).HasMaxLength(80).IsRequired();
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasIndex(x => x.IdAnimal);
            e.HasIndex(x => x.IdLote);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdAnimal).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Lote>().WithMany().HasForeignKey(x => x.IdLote).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<MovimientoAnimal>(e =>
        {
            e.ToTable("MovimientoAnimal");
            e.HasKey(x => x.IdMovimiento);
            e.Property(x => x.IdMovimiento).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdAnimal).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdLoteOrigen).HasColumnType("char(36)");
            e.Property(x => x.IdLoteDestino).HasColumnType("char(36)");
            e.Property(x => x.Tipo).HasMaxLength(30).IsRequired();
            e.Property(x => x.OrigenExterno).HasMaxLength(250);
            e.Property(x => x.DestinoExterno).HasMaxLength(250);
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasIndex(x => x.IdAnimal);
            e.HasIndex(x => x.Fecha);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdAnimal).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Lote>().WithMany().HasForeignKey(x => x.IdLoteOrigen).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Lote>().WithMany().HasForeignKey(x => x.IdLoteDestino).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<EventoSanitario>(e =>
        {
            e.ToTable("EventoSanitario");
            e.HasKey(x => x.IdEventoSanitario);
            e.Property(x => x.IdEventoSanitario).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdAnimal).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.Tipo).HasMaxLength(35).IsRequired();
            e.Property(x => x.ProfesionalDiagnostico).HasMaxLength(180);
            e.Property(x => x.EvidenciaDiagnosticoUri).HasMaxLength(500);
            e.Property(x => x.Responsable).HasMaxLength(180).IsRequired();
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasIndex(x => x.IdAnimal);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdAnimal).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Tratamiento>(e =>
        {
            e.ToTable("Tratamiento");
            e.HasKey(x => x.IdTratamiento);
            e.Property(x => x.IdTratamiento).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdEventoSanitario).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.Producto).HasMaxLength(150).IsRequired();
            e.Property(x => x.Dosis).HasPrecision(10, 3).IsRequired();
            e.Property(x => x.UnidadDosis).HasMaxLength(20).IsRequired();
            e.Property(x => x.ViaAdministracion).HasMaxLength(60);
            e.Property(x => x.Frecuencia).HasMaxLength(80).IsRequired();
            e.Property(x => x.Responsable).HasMaxLength(180).IsRequired();
            e.Property(x => x.PrescripcionUri).HasMaxLength(500);
            e.Property(x => x.Estado).HasMaxLength(25).IsRequired();
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasIndex(x => x.IdEventoSanitario);
            e.HasOne<EventoSanitario>().WithMany().HasForeignKey(x => x.IdEventoSanitario).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Recordatorio>(e =>
        {
            e.ToTable("Recordatorio");
            e.HasKey(x => x.IdRecordatorio);
            e.Property(x => x.IdRecordatorio).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdRancho).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdAnimal).HasColumnType("char(36)");
            e.Property(x => x.IdLote).HasColumnType("char(36)");
            e.Property(x => x.IdTratamiento).HasColumnType("char(36)");
            e.Property(x => x.IdResponsable).HasColumnType("char(36)");
            e.Property(x => x.Tipo).HasMaxLength(35).IsRequired();
            e.Property(x => x.Descripcion).HasMaxLength(250).IsRequired();
            e.Property(x => x.Estado).HasMaxLength(25).IsRequired();
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
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
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RegistroSyncServidor>(e =>
        {
            e.ToTable("RegistroSyncServidor");
            e.HasKey(x => x.IdOperacion);
            e.Property(x => x.IdOperacion).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdUsuario).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdRancho).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdDispositivo).HasMaxLength(120).IsRequired();
            e.Property(x => x.HashSolicitud).HasColumnType("char(64)").HasMaxLength(64).IsRequired();
            e.Property(x => x.Entidad).HasMaxLength(80).IsRequired();
            e.Property(x => x.IdRegistro).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.Resultado).HasColumnType("longtext").IsRequired();
            e.Property(x => x.VersionResultante).IsRequired();
            e.Property(x => x.AplicadoEn).HasPrecision(6).IsRequired();
            e.HasIndex(x => new { x.IdRancho, x.Entidad, x.IdRegistro });
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdUsuario).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<CambioServidor>(e =>
        {
            e.ToTable("CambioServidor");
            e.HasKey(x => x.IdCambio);
            e.Property(x => x.IdCambio).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdRancho).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.Entidad).HasMaxLength(80).IsRequired();
            e.Property(x => x.IdRegistro).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.Operacion).HasMaxLength(20).IsRequired();
            e.Property(x => x.Version).IsRequired();
            e.Property(x => x.OcurrioEn).HasPrecision(6).IsRequired();
            e.Property(x => x.IdUsuario).HasColumnType("char(36)");
            e.Property(x => x.IdOperacion).HasColumnType("char(36)");
            e.Property(x => x.Origen).HasMaxLength(25).IsRequired();
            e.Property(x => x.Antes).HasColumnType("longtext");
            e.Property(x => x.Despues).HasColumnType("longtext");
            e.Property(x => x.Datos).HasColumnType("longtext");
            e.HasIndex(x => new { x.IdRancho, x.OcurrioEn, x.IdCambio });
            e.HasIndex(x => new { x.IdRancho, x.Entidad, x.IdRegistro, x.Version }).IsUnique();
            e.HasIndex(x => x.IdOperacion);
            e.HasOne<Rancho>().WithMany().HasForeignKey(x => x.IdRancho).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdUsuario).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<RegistroSyncServidor>().WithMany().HasForeignKey(x => x.IdOperacion).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<GenealogiaAnimal>(e =>
        {
            e.ToTable("GenealogiaAnimal");
            e.HasKey(x => x.IdGenealogia);
            e.Property(x => x.IdGenealogia).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdAnimal).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdPadre).HasColumnType("char(36)");
            e.Property(x => x.IdMadre).HasColumnType("char(36)");
            e.Property(x => x.Observaciones).HasMaxLength(500);
            e.Property(x => x.IdAutor).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.VersionRegistro).IsConcurrencyToken();
            e.HasIndex(x => x.IdAnimal).IsUnique();
            e.HasIndex(x => x.IdPadre);
            e.HasIndex(x => x.IdMadre);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdAnimal).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdPadre).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Animal>().WithMany().HasForeignKey(x => x.IdMadre).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.IdAutor).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
