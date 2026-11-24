using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class EnhanceArchivoMultimediaMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Estado",
                table: "ArchivoMultimedia",
                type: "varchar(30)",
                maxLength: 30,
                nullable: false,
                defaultValue: "Disponible");

            migrationBuilder.AddColumn<string>(
                name: "Extension",
                table: "ArchivoMultimedia",
                type: "varchar(15)",
                maxLength: 15,
                nullable: false,
                defaultValue: ".jpg");

            migrationBuilder.AddColumn<DateTime>(
                name: "FechaCarga",
                table: "ArchivoMultimedia",
                type: "datetime(6)",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "ProveedorAlmacenamiento",
                table: "ArchivoMultimedia",
                type: "varchar(40)",
                maxLength: 40,
                nullable: false,
                defaultValue: "LocalFileSystem");

            migrationBuilder.Sql(
                """
                UPDATE ArchivoMultimedia
                SET
                    FechaCarga = CreadoEn,
                    Estado = CASE WHEN EliminadoEn IS NOT NULL THEN 'Eliminado' ELSE 'Disponible' END,
                    ProveedorAlmacenamiento = 'LocalFileSystem',
                    Extension = CASE LOWER(MimeType)
                        WHEN 'image/png' THEN '.png'
                        WHEN 'image/webp' THEN '.webp'
                        ELSE '.jpg'
                    END;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_Estado",
                table: "ArchivoMultimedia",
                column: "Estado");

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_FechaCarga",
                table: "ArchivoMultimedia",
                column: "FechaCarga");

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_IdRancho_IdAnimal_Estado",
                table: "ArchivoMultimedia",
                columns: new[] { "IdRancho", "IdAnimal", "Estado" });

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_RutaArchivo",
                table: "ArchivoMultimedia",
                column: "RutaArchivo",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ArchivoMultimedia_Estado",
                table: "ArchivoMultimedia");

            migrationBuilder.DropIndex(
                name: "IX_ArchivoMultimedia_FechaCarga",
                table: "ArchivoMultimedia");

            migrationBuilder.DropIndex(
                name: "IX_ArchivoMultimedia_IdRancho_IdAnimal_Estado",
                table: "ArchivoMultimedia");

            migrationBuilder.DropIndex(
                name: "IX_ArchivoMultimedia_RutaArchivo",
                table: "ArchivoMultimedia");

            migrationBuilder.DropColumn(
                name: "Estado",
                table: "ArchivoMultimedia");

            migrationBuilder.DropColumn(
                name: "Extension",
                table: "ArchivoMultimedia");

            migrationBuilder.DropColumn(
                name: "FechaCarga",
                table: "ArchivoMultimedia");

            migrationBuilder.DropColumn(
                name: "ProveedorAlmacenamiento",
                table: "ArchivoMultimedia");
        }
    }
}
