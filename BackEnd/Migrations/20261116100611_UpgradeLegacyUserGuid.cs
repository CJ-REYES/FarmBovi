using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class UpgradeLegacyUserGuid : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE `Usuario` RENAME COLUMN `Id` TO `IdLegacy`;");
            migrationBuilder.Sql("ALTER TABLE `Usuario` ADD COLUMN `IdUsuario` char(36) NULL AFTER `IdLegacy`;");
            migrationBuilder.Sql("UPDATE `Usuario` SET `IdUsuario` = UUID() WHERE `IdUsuario` IS NULL;");
            migrationBuilder.Sql("ALTER TABLE `Usuario` MODIFY COLUMN `IdUsuario` char(36) NOT NULL, ADD COLUMN `CreadoEn` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);");
            migrationBuilder.Sql("ALTER TABLE `Usuario` ADD UNIQUE INDEX `UX_Usuario_IdLegacy` (`IdLegacy`);");
            migrationBuilder.Sql("ALTER TABLE `Usuario` DROP PRIMARY KEY, ADD PRIMARY KEY (`IdUsuario`);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE `Recordatorio` DROP FOREIGN KEY `FK_Recordatorio_Usuario_IdResponsable`;");
            migrationBuilder.Sql("ALTER TABLE `UsuarioRancho` DROP FOREIGN KEY `FK_UsuarioRancho_Usuario_IdUsuario`;");
            migrationBuilder.Sql("ALTER TABLE `Usuario` DROP PRIMARY KEY, DROP INDEX `UX_Usuario_IdLegacy`, DROP COLUMN `IdUsuario`, DROP COLUMN `CreadoEn`, CHANGE COLUMN `IdLegacy` `Id` int NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`Id`);");
            migrationBuilder.Sql("ALTER TABLE `Recordatorio` ADD CONSTRAINT `FK_Recordatorio_Usuario_IdResponsable` FOREIGN KEY (`IdResponsable`) REFERENCES `Usuario` (`Id`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `UsuarioRancho` ADD CONSTRAINT `FK_UsuarioRancho_Usuario_IdUsuario` FOREIGN KEY (`IdUsuario`) REFERENCES `Usuario` (`Id`) ON DELETE RESTRICT;");
        }
    }
}
