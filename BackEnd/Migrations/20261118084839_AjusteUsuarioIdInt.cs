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
            // 1. Soltar FKs existentes hacia Usuario antes de modificar columnas/PK
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

            // 2. Transformar tabla Usuario (char(36) IdUsuario) -> usuario (int Id AUTO_INCREMENT)
            // Usamos una tabla puente temporal para mapear GUIDs previos a IDs INT sin perder filas
            migrationBuilder.Sql(@"
                CREATE TEMPORARY TABLE IF NOT EXISTS _tmp_usuario_map (
                    OldGuid char(36) NOT NULL PRIMARY KEY,
                    NewIntId int NOT NULL AUTO_INCREMENT UNIQUE
                );
            ");

            migrationBuilder.Sql(@"
                SET @sql_check = (
                    SELECT IF(
                        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'Usuario'),
                        'INSERT IGNORE INTO _tmp_usuario_map (OldGuid) SELECT IdUsuario FROM Usuario;',
                        'SELECT 1;'
                    )
                );
                PREPARE stmt FROM @sql_check; EXECUTE stmt; DEALLOCATE PREPARE stmt;
            ");

            migrationBuilder.Sql(@"
                SET @sql_check2 = (
                    SELECT IF(
                        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'usuario'),
                        'INSERT IGNORE INTO _tmp_usuario_map (OldGuid) SELECT CAST(Id AS CHAR(36)) FROM usuario WHERE CAST(Id AS CHAR(36)) NOT IN (SELECT OldGuid FROM _tmp_usuario_map);',
                        'SELECT 1;'
                    )
                );
                PREPARE stmt2 FROM @sql_check2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
            ");

            // Si existe 'Usuario' con IdUsuario char(36), recrear como 'usuario' con Id int AUTO_INCREMENT
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
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            ");

            migrationBuilder.Sql(@"
                SET @sql_copy_users = (
                    SELECT IF(
                        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'Usuario'),
                        'INSERT INTO `usuario_new` (`Id`, `Nombre`, `Correo`, `Contrasena`, `Estado`)
                         SELECT m.NewIntId, u.Nombre, u.Correo, u.Contrasena, u.Estado
                         FROM `Usuario` u
                         INNER JOIN `_tmp_usuario_map` m ON m.OldGuid = u.IdUsuario;',
                        'SELECT 1;'
                    )
                );
                PREPARE stmt3 FROM @sql_copy_users; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
            ");

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
                    INNER JOIN `_tmp_usuario_map` m ON CAST(t.`IdAutor` AS CHAR(36)) = m.OldGuid
                    SET t.`IdAutor` = CAST(m.NewIntId AS CHAR(36));
                ");
            }

            foreach (var tabla in new[] { "RegistroSyncServidor", "UsuarioRancho" })
            {
                migrationBuilder.Sql($@"
                    UPDATE `{tabla}` t
                    INNER JOIN `_tmp_usuario_map` m ON CAST(t.`IdUsuario` AS CHAR(36)) = m.OldGuid
                    SET t.`IdUsuario` = CAST(m.NewIntId AS CHAR(36));
                ");
            }

            migrationBuilder.Sql(@"
                UPDATE `CambioServidor` t
                INNER JOIN `_tmp_usuario_map` m ON CAST(t.`IdUsuario` AS CHAR(36)) = m.OldGuid
                SET t.`IdUsuario` = CAST(m.NewIntId AS CHAR(36))
                WHERE t.`IdUsuario` IS NOT NULL;
            ");

            migrationBuilder.Sql(@"
                UPDATE `Recordatorio` t
                INNER JOIN `_tmp_usuario_map` m ON CAST(t.`IdResponsable` AS CHAR(36)) = m.OldGuid
                SET t.`IdResponsable` = CAST(m.NewIntId AS CHAR(36))
                WHERE t.`IdResponsable` IS NOT NULL;
            ");

            // Reemplazar tabla Usuario/usuario por usuario_new
            migrationBuilder.Sql("DROP TABLE IF EXISTS `Usuario`;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS `usuario`;");
            migrationBuilder.Sql("RENAME TABLE `usuario_new` TO `usuario`;");
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
