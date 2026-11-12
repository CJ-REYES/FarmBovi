using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTrazabilidadYAlimentacion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Alimentacion",
                columns: table => new
                {
                    IdAlimentacion = table.Column<string>(type: "TEXT", nullable: false),
                    IdAnimal = table.Column<string>(type: "TEXT", nullable: false),
                    IdLote = table.Column<string>(type: "TEXT", nullable: true),
                    Alimento = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    Racion = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    Cantidad = table.Column<decimal>(type: "decimal(10,3)", nullable: false),
                    Unidad = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Frecuencia = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Inicio = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Fin = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CambioDieta = table.Column<string>(type: "TEXT", nullable: true),
                    IdAutor = table.Column<string>(type: "TEXT", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "TEXT", nullable: false),
                    VersionRegistro = table.Column<long>(type: "INTEGER", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Alimentacion", x => x.IdAlimentacion);
                });

            migrationBuilder.CreateTable(
                name: "MovimientoAnimal",
                columns: table => new
                {
                    IdMovimiento = table.Column<string>(type: "TEXT", nullable: false),
                    IdAnimal = table.Column<string>(type: "TEXT", nullable: false),
                    IdLoteOrigen = table.Column<string>(type: "TEXT", nullable: true),
                    IdLoteDestino = table.Column<string>(type: "TEXT", nullable: true),
                    Tipo = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    Fecha = table.Column<DateTime>(type: "TEXT", nullable: false),
                    OrigenExterno = table.Column<string>(type: "TEXT", maxLength: 250, nullable: true),
                    DestinoExterno = table.Column<string>(type: "TEXT", maxLength: 250, nullable: true),
                    Motivo = table.Column<string>(type: "TEXT", nullable: true),
                    IdAutor = table.Column<string>(type: "TEXT", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "TEXT", nullable: false),
                    VersionRegistro = table.Column<long>(type: "INTEGER", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MovimientoAnimal", x => x.IdMovimiento);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Alimentacion");

            migrationBuilder.DropTable(
                name: "MovimientoAnimal");
        }
    }
}
