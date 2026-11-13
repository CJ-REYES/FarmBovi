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
<<<<<<< HEAD
    public DbSet<MovimientoAnimal> MovimientosAnimales => Set<MovimientoAnimal>();
    public DbSet<Alimentacion> Alimentaciones => Set<Alimentacion>();
    public DbSet<Pesaje> Pesajes => Set<Pesaje>();
    public DbSet<Tratamiento> Tratamientos => Set<Tratamiento>();
    public DbSet<Reproduccion> Reproduccion => Set<Reproduccion>();
=======
    public DbSet<MovimientoAnimal> MovimientosAnimales { get; set; }
    public DbSet<Alimentacion> Alimentaciones { get; set; }
    public DbSet<EventoSanitario> EventosSanitarios => Set<EventoSanitario>();
    public DbSet<Tratamiento> Tratamientos => Set<Tratamiento>();
    public DbSet<Recordatorio> Recordatorios => Set<Recordatorio>();

>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676
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

<<<<<<< HEAD
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
=======
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
>>>>>>> d9999792f4d9a2c9826e13b12a28be41cb0d0676
        });
    }
}