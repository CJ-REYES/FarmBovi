using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSanidadYAgendaModels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EventoSanitario",
                columns: table => new
                {
                    IdEventoSanitario = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    IdAnimal = table.Column<int>(type: "int", nullable: false),
                    Tipo = table.Column<string>(type: "varchar(35)", maxLength: 35, nullable: false),
                    Fecha = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Sintomas = table.Column<string>(type: "varchar(2000)", maxLength: 2000, nullable: true),
                    Diagnostico = table.Column<string>(type: "varchar(2000)", maxLength: 2000, nullable: true),
                    ProfesionalDiagnostico = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: true),
                    EvidenciaDiagnosticoUri = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    Responsable = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    Observaciones = table.Column<string>(type: "varchar(2000)", maxLength: 2000, nullable: true),
                    IdAutor = table.Column<int>(type: "int", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventoSanitario", x => x.IdEventoSanitario);
                    table.ForeignKey(
                        name: "FK_EventoSanitario_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Tratamiento",
                columns: table => new
                {
                    IdTratamiento = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    IdEventoSanitario = table.Column<int>(type: "int", nullable: false),
                    Producto = table.Column<string>(type: "varchar(150)", maxLength: 150, nullable: false),
                    Dosis = table.Column<decimal>(type: "decimal(10,3)", precision: 10, scale: 3, nullable: false),
                    UnidadDosis = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    ViaAdministracion = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: true),
                    Frecuencia = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    FechaInicio = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    FechaFin = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    Responsable = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    PrescripcionUri = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    Estado = table.Column<string>(type: "varchar(25)", maxLength: 25, nullable: false),
                    IdAutor = table.Column<int>(type: "int", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tratamiento", x => x.IdTratamiento);
                    table.ForeignKey(
                        name: "FK_Tratamiento_EventoSanitario_IdEventoSanitario",
                        column: x => x.IdEventoSanitario,
                        principalTable: "EventoSanitario",
                        principalColumn: "IdEventoSanitario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Recordatorio",
                columns: table => new
                {
                    IdRecordatorio = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    IdRancho = table.Column<int>(type: "int", nullable: false),
                    IdAnimal = table.Column<int>(type: "int", nullable: true),
                    IdLote = table.Column<int>(type: "int", nullable: true),
                    IdTratamiento = table.Column<int>(type: "int", nullable: true),
                    IdResponsable = table.Column<int>(type: "int", nullable: true),
                    Tipo = table.Column<string>(type: "varchar(35)", maxLength: 35, nullable: false),
                    Descripcion = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: false),
                    FechaProgramada = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Estado = table.Column<string>(type: "varchar(25)", maxLength: 25, nullable: false),
                    FechaCompletado = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    IdAutor = table.Column<int>(type: "int", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recordatorio", x => x.IdRecordatorio);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Lote_IdLote",
                        column: x => x.IdLote,
                        principalTable: "Lote",
                        principalColumn: "IdLote",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Tratamiento_IdTratamiento",
                        column: x => x.IdTratamiento,
                        principalTable: "Tratamiento",
                        principalColumn: "IdTratamiento",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Usuario_IdResponsable",
                        column: x => x.IdResponsable,
                        principalTable: "Usuario",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_EventoSanitario_IdAnimal",
                table: "EventoSanitario",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_FechaProgramada",
                table: "Recordatorio",
                column: "FechaProgramada");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdAnimal",
                table: "Recordatorio",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdLote",
                table: "Recordatorio",
                column: "IdLote");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdRancho",
                table: "Recordatorio",
                column: "IdRancho");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdResponsable",
                table: "Recordatorio",
                column: "IdResponsable");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdTratamiento",
                table: "Recordatorio",
                column: "IdTratamiento");

            migrationBuilder.CreateIndex(
                name: "IX_Tratamiento_IdEventoSanitario",
                table: "Tratamiento",
                column: "IdEventoSanitario");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Recordatorio");

            migrationBuilder.DropTable(
                name: "Tratamiento");

            migrationBuilder.DropTable(
                name: "EventoSanitario");
        }
    }
}
