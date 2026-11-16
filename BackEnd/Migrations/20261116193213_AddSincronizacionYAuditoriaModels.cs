using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSincronizacionYAuditoriaModels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CambioServidor_IdRancho_Entidad_IdRegistro",
                table: "CambioServidor");

            migrationBuilder.AlterColumn<string>(
                name: "Resultado",
                table: "RegistroSyncServidor",
                type: "longtext",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "json");

            migrationBuilder.AlterColumn<string>(
                name: "IdDispositivo",
                table: "RegistroSyncServidor",
                type: "varchar(120)",
                maxLength: 120,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "varchar(80)",
                oldMaxLength: 80);

            migrationBuilder.AlterColumn<Guid>(
                name: "IdUsuario",
                table: "CambioServidor",
                type: "char(36)",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "char(36)");

            migrationBuilder.AlterColumn<string>(
                name: "Despues",
                table: "CambioServidor",
                type: "longtext",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "json",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Antes",
                table: "CambioServidor",
                type: "longtext",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "json",
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Datos",
                table: "CambioServidor",
                type: "longtext",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CambioServidor_IdRancho_Entidad_IdRegistro_Version",
                table: "CambioServidor",
                columns: new[] { "IdRancho", "Entidad", "IdRegistro", "Version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CambioServidor_IdRancho_Entidad_IdRegistro_Version",
                table: "CambioServidor");

            migrationBuilder.DropColumn(
                name: "Datos",
                table: "CambioServidor");

            migrationBuilder.AlterColumn<string>(
                name: "Resultado",
                table: "RegistroSyncServidor",
                type: "json",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "longtext");

            migrationBuilder.AlterColumn<string>(
                name: "IdDispositivo",
                table: "RegistroSyncServidor",
                type: "varchar(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "varchar(120)",
                oldMaxLength: 120);

            migrationBuilder.AlterColumn<Guid>(
                name: "IdUsuario",
                table: "CambioServidor",
                type: "char(36)",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "char(36)",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Despues",
                table: "CambioServidor",
                type: "json",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "longtext",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Antes",
                table: "CambioServidor",
                type: "json",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "longtext",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CambioServidor_IdRancho_Entidad_IdRegistro",
                table: "CambioServidor",
                columns: new[] { "IdRancho", "Entidad", "IdRegistro" });
        }
    }
}
