using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations;

public partial class AddAtomicBootstrapRegistration : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.CreateTable(
        name: "RegistroInicial",
        columns: table => new
        {
            Id = table.Column<int>(type: "int", nullable: false),
            RegistradoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false)
        },
        constraints: table => table.PrimaryKey("PK_RegistroInicial", x => x.Id));

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropTable(name: "RegistroInicial");
}
