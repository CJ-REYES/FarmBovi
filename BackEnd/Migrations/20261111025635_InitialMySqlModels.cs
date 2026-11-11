using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialMySqlModels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Rancho",
                columns: table => new
                {
                    IdRancho = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Nombre = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    UbicacionGeneral = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: false),
                    Estado = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    IdAutor = table.Column<int>(type: "int", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Rancho", x => x.IdRancho);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Usuario",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    Nombre = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    Correo = table.Column<string>(type: "varchar(254)", maxLength: 254, nullable: false),
                    Contrasena = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: false),
                    Estado = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Usuario", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Lote",
                columns: table => new
                {
                    IdLote = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    IdRancho = table.Column<int>(type: "int", nullable: false),
                    Nombre = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    Ubicacion = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: true),
                    Estado = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    IdAutor = table.Column<int>(type: "int", nullable: false),
                    FechaCreacion = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Lote", x => x.IdLote);
                    table.ForeignKey(
                        name: "FK_Lote_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "UsuarioRancho",
                columns: table => new
                {
                    IdUsuarioRancho = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    IdUsuario = table.Column<int>(type: "int", nullable: false),
                    IdRancho = table.Column<int>(type: "int", nullable: false),
                    Rol = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: false),
                    Estado = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    FechaAlta = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    FechaBaja = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UsuarioRancho", x => x.IdUsuarioRancho);
                    table.ForeignKey(
                        name: "FK_UsuarioRancho_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UsuarioRancho_Usuario_IdUsuario",
                        column: x => x.IdUsuario,
                        principalTable: "Usuario",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Animal",
                columns: table => new
                {
                    IdAnimal = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    IdRancho = table.Column<int>(type: "int", nullable: false),
                    IdLote = table.Column<int>(type: "int", nullable: false),
                    Arete = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: false),
                    Raza = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    Sexo = table.Column<string>(type: "varchar(12)", maxLength: 12, nullable: false),
                    FechaNacimiento = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    FechaIngreso = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Procedencia = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    Estado = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    FechaSalida = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    Observaciones = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    IdAutor = table.Column<int>(type: "int", nullable: false),
                    FechaCreacion = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Animal", x => x.IdAnimal);
                    table.ForeignKey(
                        name: "FK_Animal_Lote_IdLote",
                        column: x => x.IdLote,
                        principalTable: "Lote",
                        principalColumn: "IdLote",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Animal_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_Animal_IdLote",
                table: "Animal",
                column: "IdLote");

            migrationBuilder.CreateIndex(
                name: "IX_Animal_IdRancho_Arete",
                table: "Animal",
                columns: new[] { "IdRancho", "Arete" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Lote_IdRancho_Nombre",
                table: "Lote",
                columns: new[] { "IdRancho", "Nombre" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Usuario_Correo",
                table: "Usuario",
                column: "Correo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UsuarioRancho_IdRancho",
                table: "UsuarioRancho",
                column: "IdRancho");

            migrationBuilder.CreateIndex(
                name: "IX_UsuarioRancho_IdUsuario_IdRancho",
                table: "UsuarioRancho",
                columns: new[] { "IdUsuario", "IdRancho" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Animal");

            migrationBuilder.DropTable(
                name: "UsuarioRancho");

            migrationBuilder.DropTable(
                name: "Lote");

            migrationBuilder.DropTable(
                name: "Usuario");

            migrationBuilder.DropTable(
                name: "Rancho");
        }
    }
}
