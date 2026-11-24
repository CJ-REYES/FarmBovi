using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPesaje : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS `_sp_add_pesaje_seguro`;");
            migrationBuilder.Sql(@"
                CREATE PROCEDURE `_sp_add_pesaje_seguro`()
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE CONVERT(table_schema USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_unicode_ci
                          AND LOWER(CONVERT(table_name USING utf8mb4)) COLLATE utf8mb4_unicode_ci = _utf8mb4'pesaje' COLLATE utf8mb4_unicode_ci
                    ) THEN
                        CREATE TABLE `Pesaje` (
                            `IdPesaje` char(36) NOT NULL,
                            `IdAnimal` char(36) NOT NULL,
                            `PesoRealKg` decimal(10,3) NOT NULL,
                            `Fecha` datetime(6) NOT NULL,
                            `FuenteBascula` varchar(150) NOT NULL,
                            `Responsable` varchar(180) NOT NULL,
                            `Observaciones` varchar(500) NULL,
                            `OrigenPesaje` varchar(30) NOT NULL,
                            `IdAutor` int NOT NULL,
                            `CreadoEn` datetime(6) NOT NULL,
                            `VersionRegistro` bigint NOT NULL,
                            `EliminadoEn` datetime(6) NULL,
                            PRIMARY KEY (`IdPesaje`),
                            KEY `IX_Pesaje_Fecha` (`Fecha`),
                            KEY `IX_Pesaje_IdAnimal` (`IdAnimal`),
                            KEY `IX_Pesaje_IdAutor` (`IdAutor`),
                            CONSTRAINT `FK_Pesaje_Animal_IdAnimal` FOREIGN KEY (`IdAnimal`) REFERENCES `Animal` (`IdAnimal`) ON DELETE RESTRICT,
                            CONSTRAINT `FK_Pesaje_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `usuario` (`Id`) ON DELETE RESTRICT
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                    END IF;
                END;
            ");
            migrationBuilder.Sql("CALL `_sp_add_pesaje_seguro`();");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS `_sp_add_pesaje_seguro`;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Pesaje");
        }
    }
}
