using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEventoReproductivo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EventoReproductivo",
                columns: table => new
                {
                    IdEventoReproductivo = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdSemental = table.Column<Guid>(type: "char(36)", nullable: true),
                    Tipo = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: false),
                    Fecha = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Resultado = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: true),
                    Observaciones = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventoReproductivo", x => x.IdEventoReproductivo);
                    table.ForeignKey(
                        name: "FK_EventoReproductivo_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EventoReproductivo_Animal_IdSemental",
                        column: x => x.IdSemental,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EventoReproductivo_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_EventoReproductivo_Fecha",
                table: "EventoReproductivo",
                column: "Fecha");

            migrationBuilder.CreateIndex(
                name: "IX_EventoReproductivo_IdAnimal",
                table: "EventoReproductivo",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_EventoReproductivo_IdAnimal_Fecha",
                table: "EventoReproductivo",
                columns: new[] { "IdAnimal", "Fecha" });

            migrationBuilder.CreateIndex(
                name: "IX_EventoReproductivo_IdAutor",
                table: "EventoReproductivo",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_EventoReproductivo_IdSemental",
                table: "EventoReproductivo",
                column: "IdSemental");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EventoReproductivo");
        }
    }
}
