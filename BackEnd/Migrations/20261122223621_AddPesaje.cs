using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPesaje : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Pesaje",
                columns: table => new
                {
                    IdPesaje = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: false),
                    PesoRealKg = table.Column<decimal>(type: "decimal(10,3)", precision: 10, scale: 3, nullable: false),
                    Fecha = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    FuenteBascula = table.Column<string>(type: "varchar(150)", maxLength: 150, nullable: false),
                    Responsable = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    Observaciones = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    OrigenPesaje = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Pesaje", x => x.IdPesaje);
                    table.ForeignKey(
                        name: "FK_Pesaje_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Pesaje_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_Pesaje_Fecha",
                table: "Pesaje",
                column: "Fecha");

            migrationBuilder.CreateIndex(
                name: "IX_Pesaje_IdAnimal",
                table: "Pesaje",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_Pesaje_IdAutor",
                table: "Pesaje",
                column: "IdAutor");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Pesaje");
        }
    }
}
