using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    public partial class AddCambioServidor : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CambioServidor",
                columns: table => new
                {
                    IdCambio = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    Entidad = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    IdRegistro = table.Column<Guid>(type: "char(36)", nullable: false),
                    Operacion = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    OcurrioEn = table.Column<DateTime>(type: "datetime(6)", precision: 6, nullable: false),
                    IdUsuario = table.Column<Guid>(type: "char(36)", nullable: true),
                    Datos = table.Column<string>(type: "longtext", nullable: true)
                },
                constraints: table => table.PrimaryKey("PK_CambioServidor", x => x.IdCambio))
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_CambioServidor_IdRancho_OcurrioEn_IdCambio",
                table: "CambioServidor",
                columns: new[] { "IdRancho", "OcurrioEn", "IdCambio" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "CambioServidor");
        }
    }
}
