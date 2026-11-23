using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGenealogiaAnimal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GenealogiaAnimal",
                columns: table => new
                {
                    IdGenealogia = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdPadre = table.Column<Guid>(type: "char(36)", nullable: true),
                    IdMadre = table.Column<Guid>(type: "char(36)", nullable: true),
                    Observaciones = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GenealogiaAnimal", x => x.IdGenealogia);
                    table.ForeignKey(
                        name: "FK_GenealogiaAnimal_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GenealogiaAnimal_Animal_IdMadre",
                        column: x => x.IdMadre,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GenealogiaAnimal_Animal_IdPadre",
                        column: x => x.IdPadre,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GenealogiaAnimal_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_GenealogiaAnimal_IdAnimal",
                table: "GenealogiaAnimal",
                column: "IdAnimal",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GenealogiaAnimal_IdAutor",
                table: "GenealogiaAnimal",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_GenealogiaAnimal_IdMadre",
                table: "GenealogiaAnimal",
                column: "IdMadre");

            migrationBuilder.CreateIndex(
                name: "IX_GenealogiaAnimal_IdPadre",
                table: "GenealogiaAnimal",
                column: "IdPadre");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GenealogiaAnimal");
        }
    }
}
