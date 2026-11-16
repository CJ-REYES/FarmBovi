using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AlignDomainGuidKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Legacy domain tables were created with integer identities while the
            // current API and EF model use GUIDs. The live database was checked
            // before applying this migration: these domain tables contain no rows.
            // Keep Usuario and its IdLegacy untouched.
            migrationBuilder.Sql("CREATE TEMPORARY TABLE `__GuidDomainMigrationGuard` (`Ok` tinyint NOT NULL CHECK (`Ok` = 1));");
            migrationBuilder.Sql("INSERT INTO `__GuidDomainMigrationGuard` (`Ok`) SELECT 0 WHERE EXISTS (SELECT 1 FROM `Rancho` UNION ALL SELECT 1 FROM `UsuarioRancho` UNION ALL SELECT 1 FROM `Lote` UNION ALL SELECT 1 FROM `Animal` UNION ALL SELECT 1 FROM `EventoSanitario` UNION ALL SELECT 1 FROM `Tratamiento` UNION ALL SELECT 1 FROM `Recordatorio` UNION ALL SELECT 1 FROM `Alimentacion` UNION ALL SELECT 1 FROM `MovimientoAnimal` LIMIT 1);");
            migrationBuilder.Sql("DROP TEMPORARY TABLE `__GuidDomainMigrationGuard`;");

            migrationBuilder.Sql("ALTER TABLE `Animal` DROP FOREIGN KEY `FK_Animal_Lote_IdLote`, DROP FOREIGN KEY `FK_Animal_Rancho_IdRancho`;");
            migrationBuilder.Sql("ALTER TABLE `EventoSanitario` DROP FOREIGN KEY `FK_EventoSanitario_Animal_IdAnimal`;");
            migrationBuilder.Sql("ALTER TABLE `Recordatorio` DROP FOREIGN KEY `FK_Recordatorio_Animal_IdAnimal`, DROP FOREIGN KEY `FK_Recordatorio_Lote_IdLote`, DROP FOREIGN KEY `FK_Recordatorio_Rancho_IdRancho`, DROP FOREIGN KEY `FK_Recordatorio_Tratamiento_IdTratamiento`, DROP FOREIGN KEY `FK_Recordatorio_Usuario_IdResponsable`;");
            migrationBuilder.Sql("ALTER TABLE `Tratamiento` DROP FOREIGN KEY `FK_Tratamiento_EventoSanitario_IdEventoSanitario`;");
            migrationBuilder.Sql("ALTER TABLE `UsuarioRancho` DROP FOREIGN KEY `FK_UsuarioRancho_Rancho_IdRancho`, DROP FOREIGN KEY `FK_UsuarioRancho_Usuario_IdUsuario`;");
            migrationBuilder.Sql("ALTER TABLE `Lote` DROP FOREIGN KEY `FK_Lote_Rancho_IdRancho`;");

            migrationBuilder.Sql("ALTER TABLE `Rancho` MODIFY `IdRancho` char(36) NOT NULL, MODIFY `IdAutor` char(36) NOT NULL, MODIFY `Estado` varchar(20) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `UsuarioRancho` MODIFY `IdUsuarioRancho` char(36) NOT NULL, MODIFY `IdUsuario` char(36) NOT NULL, MODIFY `IdRancho` char(36) NOT NULL, MODIFY `Rol` varchar(30) NOT NULL, MODIFY `Estado` varchar(20) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `Lote` MODIFY `IdLote` char(36) NOT NULL, MODIFY `IdRancho` char(36) NOT NULL, MODIFY `Nombre` varchar(120) NOT NULL, MODIFY `Ubicacion` varchar(250) NULL, MODIFY `Estado` varchar(20) NOT NULL, MODIFY `IdAutor` char(36) NOT NULL, CHANGE COLUMN `FechaCreacion` `CreadoEn` datetime(6) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `Animal` MODIFY `IdAnimal` char(36) NOT NULL, MODIFY `IdRancho` char(36) NOT NULL, MODIFY `IdLote` char(36) NULL, MODIFY `Arete` varchar(50) NOT NULL, MODIFY `Sexo` varchar(15) NOT NULL, MODIFY `FechaNacimiento` date NULL, MODIFY `FechaIngreso` date NOT NULL, MODIFY `Procedencia` varchar(250) NOT NULL, MODIFY `Estado` varchar(25) NOT NULL, MODIFY `FechaSalida` date NULL, MODIFY `IdAutor` char(36) NOT NULL, CHANGE COLUMN `FechaCreacion` `CreadoEn` datetime(6) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `EventoSanitario` MODIFY `IdEventoSanitario` char(36) NOT NULL, MODIFY `IdAnimal` char(36) NOT NULL, MODIFY `IdAutor` char(36) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `Tratamiento` MODIFY `IdTratamiento` char(36) NOT NULL, MODIFY `IdEventoSanitario` char(36) NOT NULL, MODIFY `IdAutor` char(36) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `Recordatorio` MODIFY `IdRecordatorio` char(36) NOT NULL, MODIFY `IdRancho` char(36) NOT NULL, MODIFY `IdAnimal` char(36) NULL, MODIFY `IdLote` char(36) NULL, MODIFY `IdTratamiento` char(36) NULL, MODIFY `IdResponsable` char(36) NULL, MODIFY `IdAutor` char(36) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `Alimentacion` MODIFY `IdAlimentacion` char(36) NOT NULL, MODIFY `IdAnimal` char(36) NULL, MODIFY `IdLote` char(36) NULL, MODIFY `IdAutor` char(36) NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE `MovimientoAnimal` MODIFY `IdMovimiento` char(36) NOT NULL, MODIFY `IdAnimal` char(36) NOT NULL, MODIFY `IdLoteOrigen` char(36) NULL, MODIFY `IdLoteDestino` char(36) NULL, MODIFY `IdAutor` char(36) NOT NULL;");

            migrationBuilder.CreateIndex("IX_Alimentacion_IdAnimal", "Alimentacion", "IdAnimal");
            migrationBuilder.CreateIndex("IX_Alimentacion_IdLote", "Alimentacion", "IdLote");
            migrationBuilder.CreateIndex("IX_MovimientoAnimal_IdAnimal", "MovimientoAnimal", "IdAnimal");
            migrationBuilder.CreateIndex("IX_MovimientoAnimal_Fecha", "MovimientoAnimal", "Fecha");

            migrationBuilder.Sql("ALTER TABLE `Rancho` ADD CONSTRAINT `FK_Rancho_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `UsuarioRancho` ADD CONSTRAINT `FK_UsuarioRancho_Usuario_IdUsuario` FOREIGN KEY (`IdUsuario`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_UsuarioRancho_Rancho_IdRancho` FOREIGN KEY (`IdRancho`) REFERENCES `Rancho` (`IdRancho`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `Lote` ADD CONSTRAINT `FK_Lote_Rancho_IdRancho` FOREIGN KEY (`IdRancho`) REFERENCES `Rancho` (`IdRancho`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Lote_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `Animal` ADD CONSTRAINT `FK_Animal_Lote_IdLote` FOREIGN KEY (`IdLote`) REFERENCES `Lote` (`IdLote`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Animal_Rancho_IdRancho` FOREIGN KEY (`IdRancho`) REFERENCES `Rancho` (`IdRancho`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Animal_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `Alimentacion` ADD CONSTRAINT `FK_Alimentacion_Animal_IdAnimal` FOREIGN KEY (`IdAnimal`) REFERENCES `Animal` (`IdAnimal`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Alimentacion_Lote_IdLote` FOREIGN KEY (`IdLote`) REFERENCES `Lote` (`IdLote`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Alimentacion_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `MovimientoAnimal` ADD CONSTRAINT `FK_MovimientoAnimal_Animal_IdAnimal` FOREIGN KEY (`IdAnimal`) REFERENCES `Animal` (`IdAnimal`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_MovimientoAnimal_Lote_IdLoteOrigen` FOREIGN KEY (`IdLoteOrigen`) REFERENCES `Lote` (`IdLote`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_MovimientoAnimal_Lote_IdLoteDestino` FOREIGN KEY (`IdLoteDestino`) REFERENCES `Lote` (`IdLote`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_MovimientoAnimal_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `EventoSanitario` ADD CONSTRAINT `FK_EventoSanitario_Animal_IdAnimal` FOREIGN KEY (`IdAnimal`) REFERENCES `Animal` (`IdAnimal`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_EventoSanitario_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `Tratamiento` ADD CONSTRAINT `FK_Tratamiento_EventoSanitario_IdEventoSanitario` FOREIGN KEY (`IdEventoSanitario`) REFERENCES `EventoSanitario` (`IdEventoSanitario`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Tratamiento_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
            migrationBuilder.Sql("ALTER TABLE `Recordatorio` ADD CONSTRAINT `FK_Recordatorio_Animal_IdAnimal` FOREIGN KEY (`IdAnimal`) REFERENCES `Animal` (`IdAnimal`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Recordatorio_Lote_IdLote` FOREIGN KEY (`IdLote`) REFERENCES `Lote` (`IdLote`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Recordatorio_Rancho_IdRancho` FOREIGN KEY (`IdRancho`) REFERENCES `Rancho` (`IdRancho`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Recordatorio_Tratamiento_IdTratamiento` FOREIGN KEY (`IdTratamiento`) REFERENCES `Tratamiento` (`IdTratamiento`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Recordatorio_Usuario_IdAutor` FOREIGN KEY (`IdAutor`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT, ADD CONSTRAINT `FK_Recordatorio_Usuario_IdResponsable` FOREIGN KEY (`IdResponsable`) REFERENCES `Usuario` (`IdUsuario`) ON DELETE RESTRICT;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("La conversión de claves GUID no puede revertirse sin reconstruir el esquema y las claves relacionadas.");
        }
    }
}
