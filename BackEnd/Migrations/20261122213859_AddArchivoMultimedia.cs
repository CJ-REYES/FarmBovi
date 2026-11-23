using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddArchivoMultimedia : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ArchivoMultimedia",
                columns: table => new
                {
                    IdArchivo = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: true),
                    EntidadRelacionada = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: false),
                    IdEntidadRelacionada = table.Column<Guid>(type: "char(36)", nullable: true),
                    Tipo = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    NombreArchivo = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: false),
                    MimeType = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: false),
                    TamanoBytes = table.Column<long>(type: "bigint", nullable: false),
                    ChecksumSha256 = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    RutaArchivo = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: false),
                    FechaCaptura = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArchivoMultimedia", x => x.IdArchivo);
                    table.ForeignKey(
                        name: "FK_ArchivoMultimedia_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ArchivoMultimedia_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ArchivoMultimedia_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_FechaCaptura",
                table: "ArchivoMultimedia",
                column: "FechaCaptura");

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_IdAnimal",
                table: "ArchivoMultimedia",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_IdAutor",
                table: "ArchivoMultimedia",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_ArchivoMultimedia_IdRancho",
                table: "ArchivoMultimedia",
                column: "IdRancho");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ArchivoMultimedia");
        }
    }
}
