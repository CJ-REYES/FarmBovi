using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Data;

public sealed class FarmDbContext(DbContextOptions<FarmDbContext> options) : DbContext(options)
{
    public DbSet<Cattle> Cattle => Set<Cattle>();

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
    }
}
