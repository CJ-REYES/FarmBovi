using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Data;

public sealed class FarmDbContext(DbContextOptions<FarmDbContext> options) : DbContext(options)
{
    public DbSet<Cattle> Cattle => Set<Cattle>();
    public DbSet<EventoSanitario> EventosSanitarios => Set<EventoSanitario>();
    public DbSet<Tratamiento> Tratamientos => Set<Tratamiento>();
    public DbSet<Recordatorio> Recordatorios => Set<Recordatorio>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var animal = modelBuilder.Entity<Cattle>();
        animal.ToTable("Cattle");
        animal.HasKey(value => value.Id);
        animal.Property(value => value.EarTag).IsRequired().HasMaxLength(40);
        animal.HasIndex(value => value.EarTag).IsUnique();
        animal.Property(value => value.Name).HasMaxLength(80);
        animal.Property(value => value.Breed).IsRequired().HasMaxLength(80);
        animal.Property(value => value.Sex).IsRequired().HasMaxLength(6);
        animal.Property(value => value.CreatedAt).HasConversion(
            value => value,
            value => DateTime.SpecifyKind(value, DateTimeKind.Utc));

        var evento = modelBuilder.Entity<EventoSanitario>();
        evento.ToTable("EventoSanitario");
        evento.HasKey(value => value.IdEventoSanitario);
        evento.Property(value => value.IdEventoSanitario).HasColumnName("idEventoSanitario").HasMaxLength(36).IsRequired();
        evento.Property(value => value.IdAnimal).HasColumnName("idAnimal").HasMaxLength(36).IsRequired();
        evento.HasIndex(value => value.IdAnimal);
        evento.Property(value => value.Tipo).HasColumnName("tipo").HasMaxLength(35).IsRequired();
        evento.Property(value => value.Fecha).HasColumnName("fecha").IsRequired();
        evento.Property(value => value.Sintomas).HasColumnName("sintomas");
        evento.Property(value => value.Diagnostico).HasColumnName("diagnostico");
        evento.Property(value => value.ProfesionalDiagnostico).HasColumnName("profesionalDiagnostico").HasMaxLength(180);
        evento.Property(value => value.EvidenciaDiagnosticoUri).HasColumnName("evidenciaDiagnosticoURI").HasMaxLength(500);
        evento.Property(value => value.Responsable).HasColumnName("responsable").HasMaxLength(180).IsRequired();
        evento.Property(value => value.Observaciones).HasColumnName("observaciones");
        evento.Property(value => value.IdAutor).HasColumnName("idAutor").HasMaxLength(36).IsRequired();
        evento.Property(value => value.CreadoEn).HasColumnName("creadoEn").IsRequired();
        evento.Property(value => value.VersionRegistro).HasColumnName("versionRegistro").IsRequired();
        evento.Property(value => value.EliminadoEn).HasColumnName("eliminadoEn");

        var tratamiento = modelBuilder.Entity<Tratamiento>();
        tratamiento.ToTable("Tratamiento");
        tratamiento.HasKey(value => value.IdTratamiento);
        tratamiento.Property(value => value.IdTratamiento).HasColumnName("idTratamiento").HasMaxLength(36).IsRequired();
        tratamiento.Property(value => value.IdEventoSanitario).HasColumnName("idEventoSanitario").HasMaxLength(36).IsRequired();
        tratamiento.HasIndex(value => value.IdEventoSanitario);
        tratamiento.Property(value => value.Producto).HasColumnName("producto").HasMaxLength(150).IsRequired();
        tratamiento.Property(value => value.Dosis).HasColumnName("dosis").HasPrecision(10, 3).IsRequired();
        tratamiento.Property(value => value.UnidadDosis).HasColumnName("unidadDosis").HasMaxLength(20).IsRequired();
        tratamiento.Property(value => value.ViaAdministracion).HasColumnName("viaAdministracion").HasMaxLength(60);
        tratamiento.Property(value => value.Frecuencia).HasColumnName("frecuencia").HasMaxLength(80).IsRequired();
        tratamiento.Property(value => value.FechaInicio).HasColumnName("fechaInicio").IsRequired();
        tratamiento.Property(value => value.FechaFin).HasColumnName("fechaFin");
        tratamiento.Property(value => value.Responsable).HasColumnName("responsable").HasMaxLength(180).IsRequired();
        tratamiento.Property(value => value.PrescripcionUri).HasColumnName("prescripcionURI").HasMaxLength(500);
        tratamiento.Property(value => value.Estado).HasColumnName("estado").HasMaxLength(25).IsRequired();
        tratamiento.Property(value => value.IdAutor).HasColumnName("idAutor").HasMaxLength(36).IsRequired();
        tratamiento.Property(value => value.CreadoEn).HasColumnName("creadoEn").IsRequired();
        tratamiento.Property(value => value.VersionRegistro).HasColumnName("versionRegistro").IsRequired();
        tratamiento.Property(value => value.EliminadoEn).HasColumnName("eliminadoEn");
        tratamiento.HasOne(value => value.EventoSanitario)
            .WithMany(value => value.Tratamientos)
            .HasForeignKey(value => value.IdEventoSanitario)
            .OnDelete(DeleteBehavior.Restrict);

        var recordatorio = modelBuilder.Entity<Recordatorio>();
        recordatorio.ToTable("Recordatorio");
        recordatorio.HasKey(value => value.IdRecordatorio);
        recordatorio.Property(value => value.IdRecordatorio).HasColumnName("idRecordatorio").HasMaxLength(36).IsRequired();
        recordatorio.Property(value => value.IdRancho).HasColumnName("idRancho").HasMaxLength(36).IsRequired();
        recordatorio.Property(value => value.IdAnimal).HasColumnName("idAnimal").HasMaxLength(36);
        recordatorio.Property(value => value.IdLote).HasColumnName("idLote").HasMaxLength(36);
        recordatorio.Property(value => value.IdTratamiento).HasColumnName("idTratamiento").HasMaxLength(36);
        recordatorio.Property(value => value.IdResponsable).HasColumnName("idResponsable").HasMaxLength(36);
        recordatorio.Property(value => value.Tipo).HasColumnName("tipo").HasMaxLength(35).IsRequired();
        recordatorio.Property(value => value.Descripcion).HasColumnName("descripcion").HasMaxLength(250).IsRequired();
        recordatorio.Property(value => value.FechaProgramada).HasColumnName("fechaProgramada").IsRequired();
        recordatorio.Property(value => value.Estado).HasColumnName("estado").HasMaxLength(25).IsRequired();
        recordatorio.Property(value => value.FechaCompletado).HasColumnName("fechaCompletado");
        recordatorio.Property(value => value.IdAutor).HasColumnName("idAutor").HasMaxLength(36).IsRequired();
        recordatorio.Property(value => value.CreadoEn).HasColumnName("creadoEn").IsRequired();
        recordatorio.Property(value => value.VersionRegistro).HasColumnName("versionRegistro").IsRequired();
        recordatorio.Property(value => value.EliminadoEn).HasColumnName("eliminadoEn");
        recordatorio.HasIndex(value => value.FechaProgramada);
        recordatorio.HasIndex(value => value.Estado);
        recordatorio.HasOne(value => value.Tratamiento)
            .WithMany(value => value.Recordatorios)
            .HasForeignKey(value => value.IdTratamiento)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
