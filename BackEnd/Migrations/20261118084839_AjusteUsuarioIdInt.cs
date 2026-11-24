using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AjusteUsuarioIdInt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. Soltar FKs existentes hacia Usuario/usuario de forma segura si existen
            migrationBuilder.Sql(@"
                DROP PROCEDURE IF EXISTS `_sp_drop_fks_usuario_seguro`;
            ");
            migrationBuilder.Sql(@"
                CREATE PROCEDURE `_sp_drop_fks_usuario_seguro`()
                BEGIN
                    DECLARE done INT DEFAULT FALSE;
                    DECLARE v_table_name VARCHAR(128);
                    DECLARE v_constraint_name VARCHAR(128);
                    DECLARE cur CURSOR FOR
                        SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME
                        FROM information_schema.TABLE_CONSTRAINTS tc
                        INNER JOIN information_schema.KEY_COLUMN_USAGE kcu
                            ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                           AND tc.TABLE_NAME = kcu.TABLE_NAME
                           AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                        WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
                          AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
                          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
                          AND LOWER(kcu.REFERENCED_TABLE_NAME) = 'usuario';
                    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

                    OPEN cur;
                    read_loop: LOOP
                        FETCH cur INTO v_table_name, v_constraint_name;
                        IF done THEN
                            LEAVE read_loop;
                        END IF;
                        SET @sql = CONCAT(
                            'ALTER TABLE `', REPLACE(v_table_name, '`', '``'),
                            '` DROP FOREIGN KEY `', REPLACE(v_constraint_name, '`', '``'), '`;'
                        );
                        PREPARE stmt FROM @sql;
                        EXECUTE stmt;
                        DEALLOCATE PREPARE stmt;
                    END LOOP;
                    CLOSE cur;
                END;
            ");
            migrationBuilder.Sql("CALL `_sp_drop_fks_usuario_seguro`();");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS `_sp_drop_fks_usuario_seguro`;");

            // Soltar FK de GenealogiaAnimal si existe la tabla y la restricción
            migrationBuilder.Sql(@"
                DROP PROCEDURE IF EXISTS `_sp_drop_fk_genealogia`;
            ");
            migrationBuilder.Sql(@"
                CREATE PROCEDURE `_sp_drop_fk_genealogia`()
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.tables t
                        INNER JOIN information_schema.table_constraints tc
                            ON tc.table_schema = t.table_schema
                           AND tc.table_name = t.table_name
                        WHERE t.table_schema = DATABASE()
                          AND t.table_name = 'GenealogiaAnimal'
                          AND tc.constraint_name = 'FK_GenealogiaAnimal_Usuario_IdAutor'
                          AND tc.constraint_type = 'FOREIGN KEY'
                    ) THEN
                        ALTER TABLE `GenealogiaAnimal` DROP FOREIGN KEY `FK_GenealogiaAnimal_Usuario_IdAutor`;
                    END IF;
                END;
            ");
            migrationBuilder.Sql("CALL `_sp_drop_fk_genealogia`();");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS `_sp_drop_fk_genealogia`;");

            // 2. Transformar tabla Usuario/usuario -> usuario (int Id AUTO_INCREMENT)
            migrationBuilder.Sql(@"
                DROP TEMPORARY TABLE IF EXISTS `_tmp_usuario_map`;
                CREATE TEMPORARY TABLE `_tmp_usuario_map` (
                    `OldGuid` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
                    `NewIntId` int NOT NULL AUTO_INCREMENT UNIQUE
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            ");

            migrationBuilder.Sql(@"
                DROP TABLE IF EXISTS `usuario_new`;
                CREATE TABLE `usuario_new` (
                    `Id` int NOT NULL AUTO_INCREMENT,
                    `Nombre` varchar(120) NOT NULL,
                    `Correo` varchar(254) NOT NULL,
                    `Contrasena` varchar(500) NOT NULL,
                    `Estado` varchar(20) NOT NULL,
                    PRIMARY KEY (`Id`),
                    UNIQUE KEY `IX_usuario_Correo` (`Correo`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            ");

            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS `_sp_migrar_usuarios`;");

            migrationBuilder.Sql(@"
                CREATE PROCEDURE `_sp_migrar_usuarios`()
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE CONVERT(table_schema USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_unicode_ci
                          AND CONVERT(table_name USING utf8mb4) COLLATE utf8mb4_unicode_ci = _utf8mb4'Usuario' COLLATE utf8mb4_unicode_ci
                          AND CONVERT(column_name USING utf8mb4) COLLATE utf8mb4_unicode_ci = _utf8mb4'IdUsuario' COLLATE utf8mb4_unicode_ci
                    ) THEN
                        INSERT IGNORE INTO `_tmp_usuario_map` (`OldGuid`)
                        SELECT `IdUsuario` FROM `Usuario` WHERE `IdUsuario` IS NOT NULL;

                        INSERT INTO `usuario_new` (`Id`, `Nombre`, `Correo`, `Contrasena`, `Estado`)
                        SELECT m.`NewIntId`, u.`Nombre`, u.`Correo`, u.`Contrasena`, u.`Estado`
                        FROM `Usuario` u
                        INNER JOIN `_tmp_usuario_map` m
                            ON m.`OldGuid` COLLATE utf8mb4_unicode_ci = u.`IdUsuario` COLLATE utf8mb4_unicode_ci;
                    ELSEIF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE CONVERT(table_schema USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_unicode_ci
                          AND CONVERT(table_name USING utf8mb4) COLLATE utf8mb4_unicode_ci = _utf8mb4'Usuario' COLLATE utf8mb4_unicode_ci
                    ) THEN
                        INSERT INTO `usuario_new` (`Id`, `Nombre`, `Correo`, `Contrasena`, `Estado`)
                        SELECT `Id`, `Nombre`, `Correo`, `Contrasena`, `Estado`
                        FROM `Usuario`;
                    ELSEIF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE CONVERT(table_schema USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_unicode_ci
                          AND CONVERT(table_name USING utf8mb4) COLLATE utf8mb4_unicode_ci = _utf8mb4'usuario' COLLATE utf8mb4_unicode_ci
                    ) THEN
                        INSERT INTO `usuario_new` (`Id`, `Nombre`, `Correo`, `Contrasena`, `Estado`)
                        SELECT `Id`, `Nombre`, `Correo`, `Contrasena`, `Estado`
                        FROM `usuario`;
                    END IF;
                END;
            ");

            migrationBuilder.Sql("CALL `_sp_migrar_usuarios`();");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS `_sp_migrar_usuarios`;");

            // Mapear columnas GUID en tablas hijas a NewIntId antes de cambiar tipo a int
            string[] tablasIdAutor =
            [
                "Alimentacion",
                "Animal",
                "EventoSanitario",
                "Lote",
                "MovimientoAnimal",
                "Pesaje",
                "Rancho",
                "Recordatorio",
                "Reproduccion",
                "Tratamiento"
            ];

            foreach (var tabla in tablasIdAutor)
            {
                migrationBuilder.Sql($@"
                    UPDATE `{tabla}` t
                    INNER JOIN `_tmp_usuario_map` m
                        ON CAST(t.`IdAutor` AS CHAR(36)) COLLATE utf8mb4_unicode_ci = m.`OldGuid` COLLATE utf8mb4_unicode_ci
                    SET t.`IdAutor` = CAST(m.`NewIntId` AS CHAR(36));
                ");
            }

            foreach (var tabla in new[] { "RegistroSyncServidor", "UsuarioRancho" })
            {
                migrationBuilder.Sql($@"
                    UPDATE `{tabla}` t
                    INNER JOIN `_tmp_usuario_map` m
                        ON CAST(t.`IdUsuario` AS CHAR(36)) COLLATE utf8mb4_unicode_ci = m.`OldGuid` COLLATE utf8mb4_unicode_ci
                    SET t.`IdUsuario` = CAST(m.`NewIntId` AS CHAR(36));
                ");
            }

            migrationBuilder.Sql(@"
                UPDATE `CambioServidor` t
                INNER JOIN `_tmp_usuario_map` m
                    ON CAST(t.`IdUsuario` AS CHAR(36)) COLLATE utf8mb4_unicode_ci = m.`OldGuid` COLLATE utf8mb4_unicode_ci
                SET t.`IdUsuario` = CAST(m.`NewIntId` AS CHAR(36))
                WHERE t.`IdUsuario` IS NOT NULL;
            ");

            migrationBuilder.Sql(@"
                UPDATE `Recordatorio` t
                INNER JOIN `_tmp_usuario_map` m
                    ON CAST(t.`IdResponsable` AS CHAR(36)) COLLATE utf8mb4_unicode_ci = m.`OldGuid` COLLATE utf8mb4_unicode_ci
                SET t.`IdResponsable` = CAST(m.`NewIntId` AS CHAR(36))
                WHERE t.`IdResponsable` IS NOT NULL;
            ");

            // Reemplazar tabla Usuario/usuario por usuario_new
            migrationBuilder.Sql("SET FOREIGN_KEY_CHECKS = 0;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS `Usuario`;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS `usuario`;");
            migrationBuilder.Sql("RENAME TABLE `usuario_new` TO `usuario`;");
            migrationBuilder.Sql("SET FOREIGN_KEY_CHECKS = 1;");
            migrationBuilder.Sql("DROP TEMPORARY TABLE IF EXISTS `_tmp_usuario_map`;");

            // 3. Alterar columnas a int / int? en las tablas del modelo
            foreach (var tabla in tablasIdAutor)
            {
                migrationBuilder.AlterColumn<int>(
                    name: "IdAutor",
                    table: tabla,
                    type: "int",
                    nullable: false,
                    oldClrType: typeof(Guid),
                    oldType: "char(36)");
            }

            migrationBuilder.AlterColumn<int>(
                name: "IdUsuario",
                table: "RegistroSyncServidor",
                type: "int",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "char(36)");

            migrationBuilder.AlterColumn<int>(
                name: "IdUsuario",
                table: "UsuarioRancho",
                type: "int",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "char(36)");

            migrationBuilder.AlterColumn<int>(
                name: "IdUsuario",
                table: "CambioServidor",
                type: "int",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "char(36)",
                oldNullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "IdResponsable",
                table: "Recordatorio",
                type: "int",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "char(36)",
                oldNullable: true);

            // 4. Recrear claves foráneas apuntando a usuario.Id
            migrationBuilder.AddForeignKey(
                name: "FK_Alimentacion_Usuario_IdAutor",
                table: "Alimentacion",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Animal_Usuario_IdAutor",
                table: "Animal",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_EventoSanitario_Usuario_IdAutor",
                table: "EventoSanitario",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Lote_Usuario_IdAutor",
                table: "Lote",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_MovimientoAnimal_Usuario_IdAutor",
                table: "MovimientoAnimal",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Rancho_Usuario_IdAutor",
                table: "Rancho",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Recordatorio_Usuario_IdAutor",
                table: "Recordatorio",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Recordatorio_Usuario_IdResponsable",
                table: "Recordatorio",
                column: "IdResponsable",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_RegistroSyncServidor_Usuario_IdUsuario",
                table: "RegistroSyncServidor",
                column: "IdUsuario",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Tratamiento_Usuario_IdAutor",
                table: "Tratamiento",
                column: "IdAutor",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_UsuarioRancho_Usuario_IdUsuario",
                table: "UsuarioRancho",
                column: "IdUsuario",
                principalTable: "usuario",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_Alimentacion_Usuario_IdAutor", table: "Alimentacion");
            migrationBuilder.DropForeignKey(name: "FK_Animal_Usuario_IdAutor", table: "Animal");
            migrationBuilder.DropForeignKey(name: "FK_EventoSanitario_Usuario_IdAutor", table: "EventoSanitario");
            migrationBuilder.DropForeignKey(name: "FK_Lote_Usuario_IdAutor", table: "Lote");
            migrationBuilder.DropForeignKey(name: "FK_MovimientoAnimal_Usuario_IdAutor", table: "MovimientoAnimal");
            migrationBuilder.DropForeignKey(name: "FK_Rancho_Usuario_IdAutor", table: "Rancho");
            migrationBuilder.DropForeignKey(name: "FK_Recordatorio_Usuario_IdAutor", table: "Recordatorio");
            migrationBuilder.DropForeignKey(name: "FK_Recordatorio_Usuario_IdResponsable", table: "Recordatorio");
            migrationBuilder.DropForeignKey(name: "FK_RegistroSyncServidor_Usuario_IdUsuario", table: "RegistroSyncServidor");
            migrationBuilder.DropForeignKey(name: "FK_Tratamiento_Usuario_IdAutor", table: "Tratamiento");
            migrationBuilder.DropForeignKey(name: "FK_UsuarioRancho_Usuario_IdUsuario", table: "UsuarioRancho");

            string[] tablasIdAutor =
            [
                "Alimentacion",
                "Animal",
                "EventoSanitario",
                "Lote",
                "MovimientoAnimal",
                "Pesaje",
                "Rancho",
                "Recordatorio",
                "Reproduccion",
                "Tratamiento"
            ];

            foreach (var tabla in tablasIdAutor)
            {
                migrationBuilder.AlterColumn<Guid>(
                    name: "IdAutor",
                    table: tabla,
                    type: "char(36)",
                    nullable: false,
                    oldClrType: typeof(int),
                    oldType: "int");
            }

            migrationBuilder.AlterColumn<Guid>(
                name: "IdUsuario",
                table: "RegistroSyncServidor",
                type: "char(36)",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AlterColumn<Guid>(
                name: "IdUsuario",
                table: "UsuarioRancho",
                type: "char(36)",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AlterColumn<Guid>(
                name: "IdUsuario",
                table: "CambioServidor",
                type: "char(36)",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "IdResponsable",
                table: "Recordatorio",
                type: "char(36)",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);
        }
    }
}
