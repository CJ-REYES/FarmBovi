using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSyncOperationRegistry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RegistroOperacionSync",
                columns: table => new
                {
                    IdOperacion = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdUsuario = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdDispositivo = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    HashSolicitud = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    ResultadoJson = table.Column<string>(type: "longtext", nullable: false),
                    ProcesadoEn = table.Column<DateTime>(type: "datetime(6)", precision: 6, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RegistroOperacionSync", x => x.IdOperacion);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_CambioServidor_IdRancho_Entidad_IdRegistro_Version",
                table: "CambioServidor",
                columns: new[] { "IdRancho", "Entidad", "IdRegistro", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RegistroOperacionSync_IdUsuario_IdRancho_IdDispositivo_Proce~",
                table: "RegistroOperacionSync",
                columns: new[] { "IdUsuario", "IdRancho", "IdDispositivo", "ProcesadoEn" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RegistroOperacionSync");

            migrationBuilder.DropIndex(
                name: "IX_CambioServidor_IdRancho_Entidad_IdRegistro_Version",
                table: "CambioServidor");
        }
    }
}
