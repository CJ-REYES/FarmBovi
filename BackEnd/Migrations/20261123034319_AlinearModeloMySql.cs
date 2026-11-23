using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AlinearModeloMySql : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP PROCEDURE IF EXISTS `_sp_alinear_drop_fks_cambio_servidor`;
                """);

            migrationBuilder.Sql("""
                CREATE PROCEDURE `_sp_alinear_drop_fks_cambio_servidor`()
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.table_constraints
                        WHERE constraint_schema = DATABASE()
                          AND table_name = 'CambioServidor'
                          AND constraint_name = 'FK_CambioServidor_Rancho_IdRancho'
                          AND constraint_type = 'FOREIGN KEY'
                    ) THEN
                        ALTER TABLE `CambioServidor` DROP FOREIGN KEY `FK_CambioServidor_Rancho_IdRancho`;
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM information_schema.table_constraints
                        WHERE constraint_schema = DATABASE()
                          AND table_name = 'CambioServidor'
                          AND constraint_name = 'FK_CambioServidor_RegistroSyncServidor_IdOperacion'
                          AND constraint_type = 'FOREIGN KEY'
                    ) THEN
                        ALTER TABLE `CambioServidor` DROP FOREIGN KEY `FK_CambioServidor_RegistroSyncServidor_IdOperacion`;
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM information_schema.table_constraints
                        WHERE constraint_schema = DATABASE()
                          AND table_name = 'CambioServidor'
                          AND constraint_name = 'FK_CambioServidor_usuario_IdUsuario'
                          AND constraint_type = 'FOREIGN KEY'
                    ) THEN
                        ALTER TABLE `CambioServidor` DROP FOREIGN KEY `FK_CambioServidor_usuario_IdUsuario`;
                    END IF;
                END;
                """);

            migrationBuilder.Sql("""
                CALL `_sp_alinear_drop_fks_cambio_servidor`();
                DROP PROCEDURE IF EXISTS `_sp_alinear_drop_fks_cambio_servidor`;
                """);

            migrationBuilder.AddColumn<DateTime>(
                name: "CreadoEn",
                table: "usuario",
                type: "datetime(6)",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.Sql("""
                DROP PROCEDURE IF EXISTS `_sp_alinear_pesaje_peso_real_kg`;
                """);

            migrationBuilder.Sql("""
                CREATE PROCEDURE `_sp_alinear_pesaje_peso_real_kg`()
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = DATABASE()
                          AND table_name = 'Pesaje'
                    ) THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = DATABASE()
                              AND table_name = 'Pesaje'
                              AND column_name = 'PesoRealKg'
                        ) THEN
                            IF EXISTS (
                                SELECT 1 FROM information_schema.columns
                                WHERE table_schema = DATABASE()
                                  AND table_name = 'Pesaje'
                                  AND column_name = 'Peso'
                            ) THEN
                                ALTER TABLE `Pesaje` CHANGE COLUMN `Peso` `PesoRealKg` decimal(10,2) NOT NULL;
                            ELSE
                                ALTER TABLE `Pesaje` ADD COLUMN `PesoRealKg` decimal(10,2) NOT NULL DEFAULT 0.00;
                            END IF;
                        END IF;
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = DATABASE()
                          AND table_name = 'pesaje'
                    ) THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = DATABASE()
                              AND table_name = 'pesaje'
                              AND column_name = 'PesoRealKg'
                        ) THEN
                            IF EXISTS (
                                SELECT 1 FROM information_schema.columns
                                WHERE table_schema = DATABASE()
                                  AND table_name = 'pesaje'
                                  AND column_name = 'Peso'
                            ) THEN
                                ALTER TABLE `pesaje` CHANGE COLUMN `Peso` `PesoRealKg` decimal(10,2) NOT NULL;
                            ELSE
                                ALTER TABLE `pesaje` ADD COLUMN `PesoRealKg` decimal(10,2) NOT NULL DEFAULT 0.00;
                            END IF;
                        END IF;
                    END IF;
                END;
                """);

            migrationBuilder.Sql("""
                CALL `_sp_alinear_pesaje_peso_real_kg`();
                DROP PROCEDURE IF EXISTS `_sp_alinear_pesaje_peso_real_kg`;
                """);

            migrationBuilder.AlterColumn<decimal>(
                name: "PesoRealKg",
                table: "Pesaje",
                type: "decimal(10,2)",
                precision: 10,
                scale: 3,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(10,3)",
                oldPrecision: 10,
                oldScale: 3);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreadoEn",
                table: "usuario");

            migrationBuilder.AlterColumn<decimal>(
                name: "PesoRealKg",
                table: "Pesaje",
                type: "decimal(10,3)",
                precision: 10,
                scale: 3,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(10,2)",
                oldPrecision: 10,
                oldScale: 3);

            migrationBuilder.AddForeignKey(
                name: "FK_CambioServidor_Rancho_IdRancho",
                table: "CambioServidor",
                column: "IdRancho",
                principalTable: "Rancho",
                principalColumn: "IdRancho",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_CambioServidor_RegistroSyncServidor_IdOperacion",
                table: "CambioServidor",
                column: "IdOperacion",
                principalTable: "RegistroSyncServidor",
                principalColumn: "IdOperacion",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_CambioServidor_usuario_IdUsuario",
                table: "CambioServidor",
                column: "IdUsuario",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
