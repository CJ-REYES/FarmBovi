using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace FarmBovi.Api.Data;

public sealed class FarmDbContext(
    DbContextOptions<FarmDbContext> options,
    IHttpContextAccessor? httpContextAccessor = null) : DbContext(options)
{
    public DbSet<Animal> Animales => Set<Animal>();
    public DbSet<Lote> Lotes => Set<Lote>();
    public DbSet<Rancho> Ranchos => Set<Rancho>();
    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<UsuarioRancho> UsuarioRanchos => Set<UsuarioRancho>();
    public DbSet<MovimientoAnimal> MovimientosAnimales => Set<MovimientoAnimal>();
    public DbSet<Alimentacion> Alimentaciones => Set<Alimentacion>();
    public DbSet<EventoSanitario> EventosSanitarios => Set<EventoSanitario>();
    public DbSet<Tratamiento> Tratamientos => Set<Tratamiento>();
    public DbSet<Recordatorio> Recordatorios => Set<Recordatorio>();
    public DbSet<CambioServidor> CambiosServidor => Set<CambioServidor>();
    public DbSet<RegistroOperacionSync> RegistrosOperacionSync => Set<RegistroOperacionSync>();
    private bool _preparingServerChanges;
    private static readonly JsonSerializerOptions SyncJsonOptions = new(JsonSerializerDefaults.Web);

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
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
            e.Property(x => x.Datos).HasColumnType("longtext");
            e.HasIndex(x => new { x.IdRancho, x.OcurrioEn, x.IdCambio });
            e.HasIndex(x => new { x.IdRancho, x.Entidad, x.IdRegistro, x.Version }).IsUnique();
        });

        modelBuilder.Entity<RegistroOperacionSync>(e =>
        {
            e.ToTable("RegistroOperacionSync");
            e.HasKey(x => x.IdOperacion);
            e.Property(x => x.IdOperacion).HasColumnType("char(36)").ValueGeneratedNever();
            e.Property(x => x.IdUsuario).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdRancho).HasColumnType("char(36)").IsRequired();
            e.Property(x => x.IdDispositivo).HasMaxLength(120).IsRequired();
            e.Property(x => x.HashSolicitud).HasMaxLength(64).IsRequired();
            e.Property(x => x.ResultadoJson).HasColumnType("longtext").IsRequired();
            e.Property(x => x.ProcesadoEn).HasPrecision(6).IsRequired();
            e.HasIndex(x => new { x.IdUsuario, x.IdRancho, x.IdDispositivo, x.ProcesadoEn });
        });

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

        foreach (var entityType in modelBuilder.Model.GetEntityTypes()
                     .Where(t => t.ClrType != typeof(CambioServidor) && t.FindProperty("VersionRegistro") is not null))
        {
            modelBuilder.Entity(entityType.ClrType).Property<long>("VersionRegistro").IsConcurrencyToken();
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
            var entries = ChangeTracker.Entries()
                .Where(e => e.Entity is not CambioServidor and not RegistroOperacionSync &&
                            e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                .ToList();

            foreach (var entry in entries)
            {
                var entity = entry.Entity;
                var name = entity.GetType().Name;
                var entityId = GetEntityId(entity);
                if (entityId == Guid.Empty) continue;

                var ranchId = await ResolveRanchIdAsync(entity, cancellationToken);
                if (ranchId is null || ranchId == Guid.Empty) continue;

                var version = GetEntityVersion(entity);
                var operation = entry.State == EntityState.Added
                    ? "Crear"
                    : IsSoftDelete(entry) ? "Eliminar" : "Actualizar";
                var alreadyTracked = ChangeTracker.Entries<CambioServidor>().Any(e =>
                    e.Entity.IdRancho == ranchId && e.Entity.Entidad == name &&
                    e.Entity.IdRegistro == entityId && e.Entity.Version == version);
                if (alreadyTracked) continue;

                var userIdText = httpContextAccessor?.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier)
                    ?? httpContextAccessor?.HttpContext?.User.FindFirstValue("sub");
                Guid? userId = Guid.TryParse(userIdText, out var parsedUserId) ? parsedUserId : null;
                var timestamp = DateTime.UtcNow;
                var data = operation == "Eliminar"
                    ? null
                    : JsonSerializer.Serialize(entity, entity.GetType(), SyncJsonOptions);
                CambiosServidor.Add(new CambioServidor
                {
                    IdCambio = Guid.NewGuid(),
                    IdRancho = ranchId.Value,
                    Entidad = name,
                    IdRegistro = entityId,
                    Operacion = operation,
                    Version = version,
                    OcurrioEn = timestamp,
                    IdUsuario = userId,
                    Datos = data
                });
            }

            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
        finally
        {
            _preparingServerChanges = false;
        }
    }

    private static Guid GetEntityId(object entity) => entity switch
    {
        Animal x => x.IdAnimal,
        Lote x => x.IdLote,
        EventoSanitario x => x.IdEventoSanitario,
        Tratamiento x => x.IdTratamiento,
        Recordatorio x => x.IdRecordatorio,
        Alimentacion x => x.IdAlimentacion,
        MovimientoAnimal x => x.IdMovimiento,
        _ => Guid.Empty
    };

    private static long GetEntityVersion(object entity) => entity switch
    {
        Animal x => x.VersionRegistro,
        Lote x => x.VersionRegistro,
        EventoSanitario x => x.VersionRegistro,
        Tratamiento x => x.VersionRegistro,
        Recordatorio x => x.VersionRegistro,
        Alimentacion x => x.VersionRegistro,
        MovimientoAnimal x => x.VersionRegistro,
        _ => 1
    };

    private static bool IsSoftDelete(Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry entry) =>
        entry.State == EntityState.Deleted ||
        (entry.State == EntityState.Modified &&
         entry.Properties.Any(p => p.Metadata.Name == "EliminadoEn" &&
                                   p.OriginalValue is null && p.CurrentValue is DateTime));

    private async Task<Guid?> ResolveRanchIdAsync(object entity, CancellationToken ct)
    {
        switch (entity)
        {
            case Animal x: return x.IdRancho;
            case Lote x: return x.IdRancho;
            case Recordatorio x: return x.IdRancho;
            case EventoSanitario x:
                return await Animales.AsNoTracking().Where(a => a.IdAnimal == x.IdAnimal)
                    .Select(a => (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            case Tratamiento x:
                return await (from t in Tratamientos.AsNoTracking()
                              join ev in EventosSanitarios.AsNoTracking() on t.IdEventoSanitario equals ev.IdEventoSanitario
                              join a in Animales.AsNoTracking() on ev.IdAnimal equals a.IdAnimal
                              where t.IdTratamiento == x.IdTratamiento
                              select (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            case Alimentacion x when x.IdAnimal.HasValue:
                return await Animales.AsNoTracking().Where(a => a.IdAnimal == x.IdAnimal.Value)
                    .Select(a => (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            case Alimentacion x when x.IdLote.HasValue:
                return await Lotes.AsNoTracking().Where(l => l.IdLote == x.IdLote.Value)
                    .Select(l => (Guid?)l.IdRancho).FirstOrDefaultAsync(ct);
            case MovimientoAnimal x:
                return await Animales.AsNoTracking().Where(a => a.IdAnimal == x.IdAnimal)
                    .Select(a => (Guid?)a.IdRancho).FirstOrDefaultAsync(ct);
            default: return null;
        }
    }
}
