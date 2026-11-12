using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace FarmBovi.Api.Migrations;

public partial class AddServerChangeLog : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "CambioServidor",
            columns: table => new
            {
                IdCambio = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                Entidad = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                IdRegistro = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                IdRancho = table.Column<int>(type: "int", nullable: true),
                Operacion = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                OcurrioEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                DatosJson = table.Column<string>(type: "longtext", nullable: false)
            },
            constraints: table => table.PrimaryKey("PK_CambioServidor", x => x.IdCambio))
            .Annotation("MySQL:Charset", "utf8mb4");

        migrationBuilder.CreateIndex(
            name: "IX_CambioServidor_IdRancho_IdCambio",
            table: "CambioServidor",
            columns: new[] { "IdRancho", "IdCambio" });
    }

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropTable(name: "CambioServidor");
}
