using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialGuidMigration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Como tu base de datos y modelos ya están mapeados con Guid,
            // esta migración inicial le indica a EF Core que el esquema base está listo
            // para ser gestionado por la aplicación mediante Database.MigrateAsync().
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}