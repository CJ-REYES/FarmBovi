using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSincronizacionYAuditoriaModels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RegistroSyncServidor",
                columns: table => new
                {
                    IdOperacion = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false),
                    IdUsuario = table.Column<int>(type: "int", nullable: false),
                    IdRancho = table.Column<int>(type: "int", nullable: false),
                    IdDispositivo = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    HashSolicitud = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    Entidad = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    IdRegistro = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false),
                    Resultado = table.Column<string>(type: "longtext", nullable: false),
                    VersionResultante = table.Column<long>(type: "bigint", nullable: false),
                    AplicadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RegistroSyncServidor", x => x.IdOperacion);
                    table.ForeignKey(
                        name: "FK_RegistroSyncServidor_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RegistroSyncServidor_Usuario_IdUsuario",
                        column: x => x.IdUsuario,
                        principalTable: "Usuario",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "CambioAuditoria",
                columns: table => new
                {
                    IdCambio = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false),
                    IdRancho = table.Column<int>(type: "int", nullable: false),
                    IdUsuario = table.Column<int>(type: "int", nullable: false),
                    IdOperacion = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: true),
                    Entidad = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    IdRegistro = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false),
                    Accion = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    Fecha = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Origen = table.Column<string>(type: "varchar(25)", maxLength: 25, nullable: false),
                    Antes = table.Column<string>(type: "longtext", nullable: true),
                    Despues = table.Column<string>(type: "longtext", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CambioAuditoria", x => x.IdCambio);
                    table.ForeignKey(
                        name: "FK_CambioAuditoria_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CambioAuditoria_RegistroSyncServidor_IdOperacion",
                        column: x => x.IdOperacion,
                        principalTable: "RegistroSyncServidor",
                        principalColumn: "IdOperacion",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CambioAuditoria_Usuario_IdUsuario",
                        column: x => x.IdUsuario,
                        principalTable: "Usuario",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "CambioServidor",
                columns: table => new
                {
                    IdCambioRemoto = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    IdRancho = table.Column<int>(type: "int", nullable: false),
                    IdOperacion = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: true),
                    Entidad = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    IdRegistro = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false),
                    Accion = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    DatosJson = table.Column<string>(type: "longtext", nullable: false),
                    FechaCambio = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CambioServidor", x => x.IdCambioRemoto);
                    table.ForeignKey(
                        name: "FK_CambioServidor_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CambioServidor_RegistroSyncServidor_IdOperacion",
                        column: x => x.IdOperacion,
                        principalTable: "RegistroSyncServidor",
                        principalColumn: "IdOperacion",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_CambioAuditoria_Entidad_IdRegistro",
                table: "CambioAuditoria",
                columns: new[] { "Entidad", "IdRegistro" });

            migrationBuilder.CreateIndex(
                name: "IX_CambioAuditoria_IdOperacion",
                table: "CambioAuditoria",
                column: "IdOperacion");

            migrationBuilder.CreateIndex(
                name: "IX_CambioAuditoria_IdRancho_Fecha",
                table: "CambioAuditoria",
                columns: new[] { "IdRancho", "Fecha" });

            migrationBuilder.CreateIndex(
                name: "IX_CambioAuditoria_IdUsuario",
                table: "CambioAuditoria",
                column: "IdUsuario");

            migrationBuilder.CreateIndex(
                name: "IX_CambioServidor_IdOperacion",
                table: "CambioServidor",
                column: "IdOperacion");

            migrationBuilder.CreateIndex(
                name: "IX_CambioServidor_IdRancho_IdCambioRemoto",
                table: "CambioServidor",
                columns: new[] { "IdRancho", "IdCambioRemoto" });

            migrationBuilder.CreateIndex(
                name: "IX_RegistroSyncServidor_Entidad_IdRegistro",
                table: "RegistroSyncServidor",
                columns: new[] { "Entidad", "IdRegistro" });

            migrationBuilder.CreateIndex(
                name: "IX_RegistroSyncServidor_IdRancho_AplicadoEn",
                table: "RegistroSyncServidor",
                columns: new[] { "IdRancho", "AplicadoEn" });

            migrationBuilder.CreateIndex(
                name: "IX_RegistroSyncServidor_IdUsuario",
                table: "RegistroSyncServidor",
                column: "IdUsuario");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CambioAuditoria");

            migrationBuilder.DropTable(
                name: "CambioServidor");

            migrationBuilder.DropTable(
                name: "RegistroSyncServidor");
        }
    }
}
