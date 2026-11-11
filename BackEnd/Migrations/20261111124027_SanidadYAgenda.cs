using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class SanidadYAgenda : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EventoSanitario",
                columns: table => new
                {
                    idEventoSanitario = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    idAnimal = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    tipo = table.Column<string>(type: "TEXT", maxLength: 35, nullable: false),
                    fecha = table.Column<DateTime>(type: "TEXT", nullable: false),
                    sintomas = table.Column<string>(type: "TEXT", nullable: true),
                    diagnostico = table.Column<string>(type: "TEXT", nullable: true),
                    profesionalDiagnostico = table.Column<string>(type: "TEXT", maxLength: 180, nullable: true),
                    evidenciaDiagnosticoURI = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    responsable = table.Column<string>(type: "TEXT", maxLength: 180, nullable: false),
                    observaciones = table.Column<string>(type: "TEXT", nullable: true),
                    idAutor = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    creadoEn = table.Column<DateTime>(type: "TEXT", nullable: false),
                    versionRegistro = table.Column<long>(type: "INTEGER", nullable: false),
                    eliminadoEn = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventoSanitario", x => x.idEventoSanitario);
                });

            migrationBuilder.CreateTable(
                name: "Tratamiento",
                columns: table => new
                {
                    idTratamiento = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    idEventoSanitario = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    producto = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false),
                    dosis = table.Column<decimal>(type: "TEXT", precision: 10, scale: 3, nullable: false),
                    unidadDosis = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    viaAdministracion = table.Column<string>(type: "TEXT", maxLength: 60, nullable: true),
                    frecuencia = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    fechaInicio = table.Column<DateTime>(type: "TEXT", nullable: false),
                    fechaFin = table.Column<DateTime>(type: "TEXT", nullable: true),
                    responsable = table.Column<string>(type: "TEXT", maxLength: 180, nullable: false),
                    prescripcionURI = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    estado = table.Column<string>(type: "TEXT", maxLength: 25, nullable: false),
                    idAutor = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    creadoEn = table.Column<DateTime>(type: "TEXT", nullable: false),
                    versionRegistro = table.Column<long>(type: "INTEGER", nullable: false),
                    eliminadoEn = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tratamiento", x => x.idTratamiento);
                    table.ForeignKey(
                        name: "FK_Tratamiento_EventoSanitario_idEventoSanitario",
                        column: x => x.idEventoSanitario,
                        principalTable: "EventoSanitario",
                        principalColumn: "idEventoSanitario",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Recordatorio",
                columns: table => new
                {
                    idRecordatorio = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    idRancho = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    idAnimal = table.Column<string>(type: "TEXT", maxLength: 36, nullable: true),
                    idLote = table.Column<string>(type: "TEXT", maxLength: 36, nullable: true),
                    idTratamiento = table.Column<string>(type: "TEXT", maxLength: 36, nullable: true),
                    idResponsable = table.Column<string>(type: "TEXT", maxLength: 36, nullable: true),
                    tipo = table.Column<string>(type: "TEXT", maxLength: 35, nullable: false),
                    descripcion = table.Column<string>(type: "TEXT", maxLength: 250, nullable: false),
                    fechaProgramada = table.Column<DateTime>(type: "TEXT", nullable: false),
                    estado = table.Column<string>(type: "TEXT", maxLength: 25, nullable: false),
                    fechaCompletado = table.Column<DateTime>(type: "TEXT", nullable: true),
                    idAutor = table.Column<string>(type: "TEXT", maxLength: 36, nullable: false),
                    creadoEn = table.Column<DateTime>(type: "TEXT", nullable: false),
                    versionRegistro = table.Column<long>(type: "INTEGER", nullable: false),
                    eliminadoEn = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recordatorio", x => x.idRecordatorio);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Tratamiento_idTratamiento",
                        column: x => x.idTratamiento,
                        principalTable: "Tratamiento",
                        principalColumn: "idTratamiento",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EventoSanitario_idAnimal",
                table: "EventoSanitario",
                column: "idAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_estado",
                table: "Recordatorio",
                column: "estado");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_fechaProgramada",
                table: "Recordatorio",
                column: "fechaProgramada");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_idTratamiento",
                table: "Recordatorio",
                column: "idTratamiento");

            migrationBuilder.CreateIndex(
                name: "IX_Tratamiento_idEventoSanitario",
                table: "Tratamiento",
                column: "idEventoSanitario");
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
