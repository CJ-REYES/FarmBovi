using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Data;

public sealed class FarmDbContext(DbContextOptions<FarmDbContext> options) : DbContext(options)
{
    public DbSet<Animal> Animales => Set<Animal>();
    public DbSet<Lote> Lotes => Set<Lote>();
    public DbSet<Rancho> Ranchos => Set<Rancho>();
    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<UsuarioRancho> UsuarioRanchos => Set<UsuarioRancho>();
    public DbSet<MovimientoAnimal> MovimientosAnimales => Set<MovimientoAnimal>();
    public DbSet<Alimentacion> Alimentaciones => Set<Alimentacion>();
    public DbSet<Pesaje> Pesajes => Set<Pesaje>();
    public DbSet<Tratamiento> Tratamientos => Set<Tratamiento>();
    public DbSet<Reproduccion> Reproduccion => Set<Reproduccion>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
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

        modelBuilder.Entity<Alimentacion>(e =>
        {
            e.ToTable("Alimentacion");
            e.HasKey(x => x.IdAlimentacion);
            e.Property(x => x.IdAlimentacion).HasMaxLength(36);
            e.Property(x => x.IdAnimal).HasMaxLength(36).IsRequired();
            e.Property(x => x.Alimento).HasMaxLength(150).IsRequired();
            e.Property(x => x.Racion).HasMaxLength(100).IsRequired();
            e.Property(x => x.Unidad).HasMaxLength(50).IsRequired();
            e.Property(x => x.Frecuencia).HasMaxLength(50).IsRequired();
        });

        modelBuilder.Entity<MovimientoAnimal>(e =>
        {
            e.ToTable("MovimientoAnimal");
            e.HasKey(x => x.IdMovimiento); // Ajusta si tu propiedad de ID se llama diferente
            e.Property(x => x.Tipo).HasMaxLength(50).IsRequired();
        });
    }
}