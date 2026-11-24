using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBoviScaleMetadataToPesaje : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ConfianzaModelo",
                table: "Pesaje",
                type: "decimal(5,4)",
                precision: 5,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "IdArchivoMultimedia",
                table: "Pesaje",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "IdSolicitud",
                table: "Pesaje",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VersionModelo",
                table: "Pesaje",
                type: "varchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Pesaje_IdArchivoMultimedia",
                table: "Pesaje",
                column: "IdArchivoMultimedia");

            migrationBuilder.CreateIndex(
                name: "IX_Pesaje_IdSolicitud",
                table: "Pesaje",
                column: "IdSolicitud",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Pesaje_ArchivoMultimedia_IdArchivoMultimedia",
                table: "Pesaje",
                column: "IdArchivoMultimedia",
                principalTable: "ArchivoMultimedia",
                principalColumn: "IdArchivo",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Pesaje_ArchivoMultimedia_IdArchivoMultimedia",
                table: "Pesaje");

            migrationBuilder.DropIndex(
                name: "IX_Pesaje_IdArchivoMultimedia",
                table: "Pesaje");

            migrationBuilder.DropIndex(
                name: "IX_Pesaje_IdSolicitud",
                table: "Pesaje");

            migrationBuilder.DropColumn(
                name: "ConfianzaModelo",
                table: "Pesaje");

            migrationBuilder.DropColumn(
                name: "IdArchivoMultimedia",
                table: "Pesaje");

            migrationBuilder.DropColumn(
                name: "IdSolicitud",
                table: "Pesaje");

            migrationBuilder.DropColumn(
                name: "VersionModelo",
                table: "Pesaje");
        }
    }
}
