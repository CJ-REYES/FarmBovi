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
            // 1. Eliminar FKs existentes para permitir conversión segura de int -> char(36) conservando datos
            migrationBuilder.DropForeignKey(name: "FK_Lote_Rancho_IdRancho", table: "Lote");
            migrationBuilder.DropForeignKey(name: "FK_UsuarioRancho_Rancho_IdRancho", table: "UsuarioRancho");
            migrationBuilder.DropForeignKey(name: "FK_UsuarioRancho_Usuario_IdUsuario", table: "UsuarioRancho");
            migrationBuilder.DropForeignKey(name: "FK_Animal_Lote_IdLote", table: "Animal");
            migrationBuilder.DropForeignKey(name: "FK_Animal_Rancho_IdRancho", table: "Animal");
            migrationBuilder.DropForeignKey(name: "FK_EventoSanitario_Animal_IdAnimal", table: "EventoSanitario");
            migrationBuilder.DropForeignKey(name: "FK_Tratamiento_EventoSanitario_IdEventoSanitario", table: "Tratamiento");
            migrationBuilder.DropForeignKey(name: "FK_Recordatorio_Animal_IdAnimal", table: "Recordatorio");
            migrationBuilder.DropForeignKey(name: "FK_Recordatorio_Lote_IdLote", table: "Recordatorio");
            migrationBuilder.DropForeignKey(name: "FK_Recordatorio_Rancho_IdRancho", table: "Recordatorio");
            migrationBuilder.DropForeignKey(name: "FK_Recordatorio_Tratamiento_IdTratamiento", table: "Recordatorio");
            migrationBuilder.DropForeignKey(name: "FK_Recordatorio_Usuario_IdResponsable", table: "Recordatorio");

            // 2. Conversión incremental conservando filas y relaciones existentes (MySQL / MariaDB)
            migrationBuilder.Sql("""
                -- Usuario: Id (int) -> IdUsuario (char(36)) + CreadoEn
                ALTER TABLE `Usuario`
                    ADD COLUMN `_NewIdUsuario` char(36) NULL,
                    ADD COLUMN `CreadoEn` datetime(6) NULL;
                UPDATE `Usuario` SET `_NewIdUsuario` = UUID(), `CreadoEn` = UTC_TIMESTAMP(6) WHERE `_NewIdUsuario` IS NULL;

                -- Rancho: IdRancho, IdAutor -> char(36)
                ALTER TABLE `Rancho`
                    ADD COLUMN `_NewIdRancho` char(36) NULL,
                    ADD COLUMN `_NewIdAutor` char(36) NULL;
                UPDATE `Rancho` r
                    LEFT JOIN `Usuario` u ON r.`IdAutor` = u.`Id`
                    SET r.`_NewIdRancho` = UUID(),
                        r.`_NewIdAutor` = COALESCE(u.`_NewIdUsuario`, UUID());

                -- UsuarioRancho: IdUsuarioRancho, IdUsuario, IdRancho -> char(36)
                ALTER TABLE `UsuarioRancho`
                    ADD COLUMN `_NewIdUsuarioRancho` char(36) NULL,
                    ADD COLUMN `_NewIdUsuario` char(36) NULL,
                    ADD COLUMN `_NewIdRancho` char(36) NULL;
                UPDATE `UsuarioRancho` ur
                    LEFT JOIN `Usuario` u ON ur.`IdUsuario` = u.`Id`
                    LEFT JOIN `Rancho` r ON ur.`IdRancho` = r.`IdRancho`
                    SET ur.`_NewIdUsuarioRancho` = UUID(),
                        ur.`_NewIdUsuario` = COALESCE(u.`_NewIdUsuario`, UUID()),
                        ur.`_NewIdRancho` = COALESCE(r.`_NewIdRancho`, UUID());

                -- Lote: IdLote, IdRancho, IdAutor -> char(36)
                ALTER TABLE `Lote`
                    ADD COLUMN `_NewIdLote` char(36) NULL,
                    ADD COLUMN `_NewIdRancho` char(36) NULL,
                    ADD COLUMN `_NewIdAutor` char(36) NULL;
                UPDATE `Lote` l
                    LEFT JOIN `Rancho` r ON l.`IdRancho` = r.`IdRancho`
                    LEFT JOIN `Usuario` u ON l.`IdAutor` = u.`Id`
                    SET l.`_NewIdLote` = UUID(),
                        l.`_NewIdRancho` = COALESCE(r.`_NewIdRancho`, UUID()),
                        l.`_NewIdAutor` = COALESCE(u.`_NewIdUsuario`, UUID());

                -- Animal: IdAnimal, IdRancho, IdLote, IdAutor -> char(36)
                ALTER TABLE `Animal`
                    ADD COLUMN `_NewIdAnimal` char(36) NULL,
                    ADD COLUMN `_NewIdRancho` char(36) NULL,
                    ADD COLUMN `_NewIdLote` char(36) NULL,
                    ADD COLUMN `_NewIdAutor` char(36) NULL;
                UPDATE `Animal` a
                    LEFT JOIN `Rancho` r ON a.`IdRancho` = r.`IdRancho`
                    LEFT JOIN `Lote` l ON a.`IdLote` = l.`IdLote`
                    LEFT JOIN `Usuario` u ON a.`IdAutor` = u.`Id`
                    SET a.`_NewIdAnimal` = UUID(),
                        a.`_NewIdRancho` = COALESCE(r.`_NewIdRancho`, UUID()),
                        a.`_NewIdLote` = l.`_NewIdLote`,
                        a.`_NewIdAutor` = COALESCE(u.`_NewIdUsuario`, UUID());

                -- EventoSanitario: IdEventoSanitario, IdAnimal, IdAutor -> char(36)
                ALTER TABLE `EventoSanitario`
                    ADD COLUMN `_NewIdEventoSanitario` char(36) NULL,
                    ADD COLUMN `_NewIdAnimal` char(36) NULL,
                    ADD COLUMN `_NewIdAutor` char(36) NULL;
                UPDATE `EventoSanitario` ev
                    LEFT JOIN `Animal` a ON ev.`IdAnimal` = a.`IdAnimal`
                    LEFT JOIN `Usuario` u ON ev.`IdAutor` = u.`Id`
                    SET ev.`_NewIdEventoSanitario` = UUID(),
                        ev.`_NewIdAnimal` = COALESCE(a.`_NewIdAnimal`, UUID()),
                        ev.`_NewIdAutor` = COALESCE(u.`_NewIdUsuario`, UUID());

                -- Tratamiento: IdTratamiento, IdEventoSanitario, IdAutor -> char(36)
                ALTER TABLE `Tratamiento`
                    ADD COLUMN `_NewIdTratamiento` char(36) NULL,
                    ADD COLUMN `_NewIdEventoSanitario` char(36) NULL,
                    ADD COLUMN `_NewIdAutor` char(36) NULL;
                UPDATE `Tratamiento` t
                    LEFT JOIN `EventoSanitario` ev ON t.`IdEventoSanitario` = ev.`IdEventoSanitario`
                    LEFT JOIN `Usuario` u ON t.`IdAutor` = u.`Id`
                    SET t.`_NewIdTratamiento` = UUID(),
                        t.`_NewIdEventoSanitario` = COALESCE(ev.`_NewIdEventoSanitario`, UUID()),
                        t.`_NewIdAutor` = COALESCE(u.`_NewIdUsuario`, UUID());

                -- Recordatorio: IdRecordatorio, IdRancho, IdAnimal, IdLote, IdTratamiento, IdResponsable, IdAutor -> char(36)
                ALTER TABLE `Recordatorio`
                    ADD COLUMN `_NewIdRecordatorio` char(36) NULL,
                    ADD COLUMN `_NewIdRancho` char(36) NULL,
                    ADD COLUMN `_NewIdAnimal` char(36) NULL,
                    ADD COLUMN `_NewIdLote` char(36) NULL,
                    ADD COLUMN `_NewIdTratamiento` char(36) NULL,
                    ADD COLUMN `_NewIdResponsable` char(36) NULL,
                    ADD COLUMN `_NewIdAutor` char(36) NULL;
                UPDATE `Recordatorio` rec
                    LEFT JOIN `Rancho` r ON rec.`IdRancho` = r.`IdRancho`
                    LEFT JOIN `Animal` a ON rec.`IdAnimal` = a.`IdAnimal`
                    LEFT JOIN `Lote` l ON rec.`IdLote` = l.`IdLote`
                    LEFT JOIN `Tratamiento` t ON rec.`IdTratamiento` = t.`IdTratamiento`
                    LEFT JOIN `Usuario` uResp ON rec.`IdResponsable` = uResp.`Id`
                    LEFT JOIN `Usuario` uAut ON rec.`IdAutor` = uAut.`Id`
                    SET rec.`_NewIdRecordatorio` = UUID(),
                        rec.`_NewIdRancho` = COALESCE(r.`_NewIdRancho`, UUID()),
                        rec.`_NewIdAnimal` = a.`_NewIdAnimal`,
                        rec.`_NewIdLote` = l.`_NewIdLote`,
                        rec.`_NewIdTratamiento` = t.`_NewIdTratamiento`,
                        rec.`_NewIdResponsable` = uResp.`_NewIdUsuario`,
                        rec.`_NewIdAutor` = COALESCE(uAut.`_NewIdUsuario`, UUID());

                -- Eliminar índices compuestos dependientes de columnas int antes de reemplazarlas
                DROP INDEX `IX_UsuarioRancho_IdUsuario_IdRancho` ON `UsuarioRancho`;
                DROP INDEX `IX_UsuarioRancho_IdRancho` ON `UsuarioRancho`;
                DROP INDEX `IX_Lote_IdRancho_Nombre` ON `Lote`;
                DROP INDEX `IX_Animal_IdRancho_Arete` ON `Animal`;
                DROP INDEX `IX_Animal_IdLote` ON `Animal`;
                DROP INDEX `IX_EventoSanitario_IdAnimal` ON `EventoSanitario`;
                DROP INDEX `IX_Tratamiento_IdEventoSanitario` ON `Tratamiento`;
                DROP INDEX `IX_Recordatorio_IdRancho` ON `Recordatorio`;
                DROP INDEX `IX_Recordatorio_IdAnimal` ON `Recordatorio`;
                DROP INDEX `IX_Recordatorio_IdLote` ON `Recordatorio`;
                DROP INDEX `IX_Recordatorio_IdTratamiento` ON `Recordatorio`;
                DROP INDEX `IX_Recordatorio_IdResponsable` ON `Recordatorio`;

                -- Quitar AUTO_INCREMENT antes de eliminar PKs y columnas int
                ALTER TABLE `Usuario` MODIFY COLUMN `Id` int NOT NULL;
                ALTER TABLE `Rancho` MODIFY COLUMN `IdRancho` int NOT NULL;
                ALTER TABLE `UsuarioRancho` MODIFY COLUMN `IdUsuarioRancho` int NOT NULL;
                ALTER TABLE `Lote` MODIFY COLUMN `IdLote` int NOT NULL;
                ALTER TABLE `Animal` MODIFY COLUMN `IdAnimal` int NOT NULL;
                ALTER TABLE `EventoSanitario` MODIFY COLUMN `IdEventoSanitario` int NOT NULL;
                ALTER TABLE `Tratamiento` MODIFY COLUMN `IdTratamiento` int NOT NULL;
                ALTER TABLE `Recordatorio` MODIFY COLUMN `IdRecordatorio` int NOT NULL;

                -- Reemplazar PKs y FKs en cada tabla conservando todos los registros
                ALTER TABLE `Usuario`
                    DROP PRIMARY KEY,
                    DROP COLUMN `Id`,
                    CHANGE COLUMN `_NewIdUsuario` `IdUsuario` char(36) NOT NULL,
                    MODIFY COLUMN `CreadoEn` datetime(6) NOT NULL,
                    MODIFY COLUMN `Estado` varchar(20) NOT NULL,
                    ADD PRIMARY KEY (`IdUsuario`);

                ALTER TABLE `Rancho`
                    DROP PRIMARY KEY,
                    DROP COLUMN `IdRancho`,
                    DROP COLUMN `IdAutor`,
                    CHANGE COLUMN `_NewIdRancho` `IdRancho` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdAutor` `IdAutor` char(36) NOT NULL,
                    MODIFY COLUMN `Estado` varchar(20) NOT NULL,
                    ADD PRIMARY KEY (`IdRancho`);

                ALTER TABLE `UsuarioRancho`
                    DROP PRIMARY KEY,
                    DROP COLUMN `IdUsuarioRancho`,
                    DROP COLUMN `IdUsuario`,
                    DROP COLUMN `IdRancho`,
                    CHANGE COLUMN `_NewIdUsuarioRancho` `IdUsuarioRancho` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdUsuario` `IdUsuario` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdRancho` `IdRancho` char(36) NOT NULL,
                    MODIFY COLUMN `Rol` varchar(30) NOT NULL,
                    MODIFY COLUMN `Estado` varchar(20) NOT NULL,
                    ADD PRIMARY KEY (`IdUsuarioRancho`);

                ALTER TABLE `Lote`
                    DROP PRIMARY KEY,
                    DROP COLUMN `IdLote`,
                    DROP COLUMN `IdRancho`,
                    DROP COLUMN `IdAutor`,
                    CHANGE COLUMN `_NewIdLote` `IdLote` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdRancho` `IdRancho` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdAutor` `IdAutor` char(36) NOT NULL,
                    CHANGE COLUMN `FechaCreacion` `CreadoEn` datetime(6) NOT NULL,
                    MODIFY COLUMN `Nombre` varchar(120) NOT NULL,
                    MODIFY COLUMN `Ubicacion` varchar(250) NULL,
                    MODIFY COLUMN `Estado` varchar(20) NOT NULL,
                    ADD PRIMARY KEY (`IdLote`);

                ALTER TABLE `Animal`
                    DROP PRIMARY KEY,
                    DROP COLUMN `IdAnimal`,
                    DROP COLUMN `IdRancho`,
                    DROP COLUMN `IdLote`,
                    DROP COLUMN `IdAutor`,
                    CHANGE COLUMN `_NewIdAnimal` `IdAnimal` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdRancho` `IdRancho` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdLote` `IdLote` char(36) NULL,
                    CHANGE COLUMN `_NewIdAutor` `IdAutor` char(36) NOT NULL,
                    CHANGE COLUMN `FechaCreacion` `CreadoEn` datetime(6) NOT NULL,
                    MODIFY COLUMN `Arete` varchar(50) NOT NULL,
                    MODIFY COLUMN `Sexo` varchar(15) NOT NULL,
                    MODIFY COLUMN `FechaNacimiento` date NULL,
                    MODIFY COLUMN `FechaIngreso` date NOT NULL,
                    MODIFY COLUMN `Procedencia` varchar(250) NOT NULL,
                    MODIFY COLUMN `Estado` varchar(25) NOT NULL,
                    MODIFY COLUMN `FechaSalida` date NULL,
                    MODIFY COLUMN `Observaciones` longtext NULL,
                    ADD PRIMARY KEY (`IdAnimal`);

                ALTER TABLE `EventoSanitario`
                    DROP PRIMARY KEY,
                    DROP COLUMN `IdEventoSanitario`,
                    DROP COLUMN `IdAnimal`,
                    DROP COLUMN `IdAutor`,
                    CHANGE COLUMN `_NewIdEventoSanitario` `IdEventoSanitario` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdAnimal` `IdAnimal` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdAutor` `IdAutor` char(36) NOT NULL,
                    MODIFY COLUMN `Sintomas` longtext NULL,
                    MODIFY COLUMN `Diagnostico` longtext NULL,
                    MODIFY COLUMN `Observaciones` longtext NULL,
                    ADD PRIMARY KEY (`IdEventoSanitario`);

                ALTER TABLE `Tratamiento`
                    DROP PRIMARY KEY,
                    DROP COLUMN `IdTratamiento`,
                    DROP COLUMN `IdEventoSanitario`,
                    DROP COLUMN `IdAutor`,
                    CHANGE COLUMN `_NewIdTratamiento` `IdTratamiento` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdEventoSanitario` `IdEventoSanitario` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdAutor` `IdAutor` char(36) NOT NULL,
                    ADD PRIMARY KEY (`IdTratamiento`);

                ALTER TABLE `Recordatorio`
                    DROP PRIMARY KEY,
                    DROP COLUMN `IdRecordatorio`,
                    DROP COLUMN `IdRancho`,
                    DROP COLUMN `IdAnimal`,
                    DROP COLUMN `IdLote`,
                    DROP COLUMN `IdTratamiento`,
                    DROP COLUMN `IdResponsable`,
                    DROP COLUMN `IdAutor`,
                    CHANGE COLUMN `_NewIdRecordatorio` `IdRecordatorio` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdRancho` `IdRancho` char(36) NOT NULL,
                    CHANGE COLUMN `_NewIdAnimal` `IdAnimal` char(36) NULL,
                    CHANGE COLUMN `_NewIdLote` `IdLote` char(36) NULL,
                    CHANGE COLUMN `_NewIdTratamiento` `IdTratamiento` char(36) NULL,
                    CHANGE COLUMN `_NewIdResponsable` `IdResponsable` char(36) NULL,
                    CHANGE COLUMN `_NewIdAutor` `IdAutor` char(36) NOT NULL,
                    ADD PRIMARY KEY (`IdRecordatorio`);

                -- Alimentacion y MovimientoAnimal: ajustar tipos de char(36)
                ALTER TABLE `Alimentacion`
                    MODIFY COLUMN `IdAlimentacion` char(36) NOT NULL,
                    MODIFY COLUMN `IdAnimal` char(36) NULL,
                    MODIFY COLUMN `IdLote` char(36) NULL,
                    MODIFY COLUMN `IdAutor` char(36) NOT NULL;

                ALTER TABLE `MovimientoAnimal`
                    MODIFY COLUMN `IdMovimiento` char(36) NOT NULL,
                    MODIFY COLUMN `IdAnimal` char(36) NOT NULL,
                    MODIFY COLUMN `IdLoteOrigen` char(36) NULL,
                    MODIFY COLUMN `IdLoteDestino` char(36) NULL,
                    MODIFY COLUMN `IdAutor` char(36) NOT NULL;
                """);

            // 3. Crear tablas de sincronización y auditoría
            migrationBuilder.CreateTable(
                name: "RegistroSyncServidor",
                columns: table => new
                {
                    IdOperacion = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdUsuario = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdDispositivo = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    HashSolicitud = table.Column<string>(type: "char(64)", maxLength: 64, nullable: false),
                    Entidad = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    IdRegistro = table.Column<Guid>(type: "char(36)", nullable: false),
                    Resultado = table.Column<string>(type: "longtext", nullable: false),
                    VersionResultante = table.Column<long>(type: "bigint", nullable: false),
                    AplicadoEn = table.Column<DateTime>(type: "datetime(6)", precision: 6, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RegistroSyncServidor", x => x.IdOperacion);
                    table.ForeignKey(
                        name: "FK_RegistroSyncServidor_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RegistroSyncServidor_Usuario_IdUsuario",
                        column: x => x.IdUsuario,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "CambioServidor",
                columns: table => new
                {
                    IdCambio = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    Entidad = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    IdRegistro = table.Column<Guid>(type: "char(36)", nullable: false),
                    Operacion = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    OcurrioEn = table.Column<DateTime>(type: "datetime(6)", precision: 6, nullable: false),
                    IdUsuario = table.Column<Guid>(type: "char(36)", nullable: true),
                    IdOperacion = table.Column<Guid>(type: "char(36)", nullable: true),
                    Origen = table.Column<string>(type: "varchar(25)", maxLength: 25, nullable: false),
                    Antes = table.Column<string>(type: "longtext", nullable: true),
                    Despues = table.Column<string>(type: "longtext", nullable: true),
                    Datos = table.Column<string>(type: "longtext", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CambioServidor", x => x.IdCambio);
                    table.ForeignKey(
                        name: "FK_CambioServidor_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CambioServidor_RegistroSyncServidor_IdOperacion",
                        column: x => x.IdOperacion,
                        principalTable: "RegistroSyncServidor",
                        principalColumn: "IdOperacion",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CambioServidor_Usuario_IdUsuario",
                        column: x => x.IdUsuario,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            // 4. Recrear índices y FKs sobre el esquema char(36)
            migrationBuilder.CreateIndex(name: "IX_Rancho_IdAutor", table: "Rancho", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_UsuarioRancho_IdRancho", table: "UsuarioRancho", column: "IdRancho");
            migrationBuilder.CreateIndex(name: "IX_UsuarioRancho_IdUsuario_IdRancho", table: "UsuarioRancho", columns: new[] { "IdUsuario", "IdRancho" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_Lote_IdAutor", table: "Lote", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_Lote_IdRancho_Nombre", table: "Lote", columns: new[] { "IdRancho", "Nombre" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_Animal_IdAutor", table: "Animal", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_Animal_IdLote", table: "Animal", column: "IdLote");
            migrationBuilder.CreateIndex(name: "IX_Animal_IdRancho_Arete", table: "Animal", columns: new[] { "IdRancho", "Arete" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_EventoSanitario_IdAnimal", table: "EventoSanitario", column: "IdAnimal");
            migrationBuilder.CreateIndex(name: "IX_EventoSanitario_IdAutor", table: "EventoSanitario", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_Tratamiento_IdEventoSanitario", table: "Tratamiento", column: "IdEventoSanitario");
            migrationBuilder.CreateIndex(name: "IX_Tratamiento_IdAutor", table: "Tratamiento", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_Recordatorio_IdRancho", table: "Recordatorio", column: "IdRancho");
            migrationBuilder.CreateIndex(name: "IX_Recordatorio_IdAnimal", table: "Recordatorio", column: "IdAnimal");
            migrationBuilder.CreateIndex(name: "IX_Recordatorio_IdLote", table: "Recordatorio", column: "IdLote");
            migrationBuilder.CreateIndex(name: "IX_Recordatorio_IdTratamiento", table: "Recordatorio", column: "IdTratamiento");
            migrationBuilder.CreateIndex(name: "IX_Recordatorio_IdResponsable", table: "Recordatorio", column: "IdResponsable");
            migrationBuilder.CreateIndex(name: "IX_Recordatorio_IdAutor", table: "Recordatorio", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_Alimentacion_IdAnimal", table: "Alimentacion", column: "IdAnimal");
            migrationBuilder.CreateIndex(name: "IX_Alimentacion_IdAutor", table: "Alimentacion", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_Alimentacion_IdLote", table: "Alimentacion", column: "IdLote");
            migrationBuilder.CreateIndex(name: "IX_MovimientoAnimal_Fecha", table: "MovimientoAnimal", column: "Fecha");
            migrationBuilder.CreateIndex(name: "IX_MovimientoAnimal_IdAnimal", table: "MovimientoAnimal", column: "IdAnimal");
            migrationBuilder.CreateIndex(name: "IX_MovimientoAnimal_IdAutor", table: "MovimientoAnimal", column: "IdAutor");
            migrationBuilder.CreateIndex(name: "IX_MovimientoAnimal_IdLoteDestino", table: "MovimientoAnimal", column: "IdLoteDestino");
            migrationBuilder.CreateIndex(name: "IX_MovimientoAnimal_IdLoteOrigen", table: "MovimientoAnimal", column: "IdLoteOrigen");

            migrationBuilder.CreateIndex(name: "IX_RegistroSyncServidor_IdRancho_Entidad_IdRegistro", table: "RegistroSyncServidor", columns: new[] { "IdRancho", "Entidad", "IdRegistro" });
            migrationBuilder.CreateIndex(name: "IX_RegistroSyncServidor_IdUsuario", table: "RegistroSyncServidor", column: "IdUsuario");
            migrationBuilder.CreateIndex(name: "IX_CambioServidor_IdOperacion", table: "CambioServidor", column: "IdOperacion");
            migrationBuilder.CreateIndex(name: "IX_CambioServidor_IdRancho_Entidad_IdRegistro_Version", table: "CambioServidor", columns: new[] { "IdRancho", "Entidad", "IdRegistro", "Version" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_CambioServidor_IdRancho_OcurrioEn_IdCambio", table: "CambioServidor", columns: new[] { "IdRancho", "OcurrioEn", "IdCambio" });
            migrationBuilder.CreateIndex(name: "IX_CambioServidor_IdUsuario", table: "CambioServidor", column: "IdUsuario");

            migrationBuilder.AddForeignKey(name: "FK_Rancho_Usuario_IdAutor", table: "Rancho", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_UsuarioRancho_Rancho_IdRancho", table: "UsuarioRancho", column: "IdRancho", principalTable: "Rancho", principalColumn: "IdRancho", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_UsuarioRancho_Usuario_IdUsuario", table: "UsuarioRancho", column: "IdUsuario", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Lote_Rancho_IdRancho", table: "Lote", column: "IdRancho", principalTable: "Rancho", principalColumn: "IdRancho", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Lote_Usuario_IdAutor", table: "Lote", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Animal_Lote_IdLote", table: "Animal", column: "IdLote", principalTable: "Lote", principalColumn: "IdLote", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Animal_Rancho_IdRancho", table: "Animal", column: "IdRancho", principalTable: "Rancho", principalColumn: "IdRancho", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Animal_Usuario_IdAutor", table: "Animal", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_EventoSanitario_Animal_IdAnimal", table: "EventoSanitario", column: "IdAnimal", principalTable: "Animal", principalColumn: "IdAnimal", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_EventoSanitario_Usuario_IdAutor", table: "EventoSanitario", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Tratamiento_EventoSanitario_IdEventoSanitario", table: "Tratamiento", column: "IdEventoSanitario", principalTable: "EventoSanitario", principalColumn: "IdEventoSanitario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Tratamiento_Usuario_IdAutor", table: "Tratamiento", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Recordatorio_Animal_IdAnimal", table: "Recordatorio", column: "IdAnimal", principalTable: "Animal", principalColumn: "IdAnimal", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Recordatorio_Lote_IdLote", table: "Recordatorio", column: "IdLote", principalTable: "Lote", principalColumn: "IdLote", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Recordatorio_Rancho_IdRancho", table: "Recordatorio", column: "IdRancho", principalTable: "Rancho", principalColumn: "IdRancho", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Recordatorio_Tratamiento_IdTratamiento", table: "Recordatorio", column: "IdTratamiento", principalTable: "Tratamiento", principalColumn: "IdTratamiento", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Recordatorio_Usuario_IdAutor", table: "Recordatorio", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Recordatorio_Usuario_IdResponsable", table: "Recordatorio", column: "IdResponsable", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Alimentacion_Animal_IdAnimal", table: "Alimentacion", column: "IdAnimal", principalTable: "Animal", principalColumn: "IdAnimal", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Alimentacion_Lote_IdLote", table: "Alimentacion", column: "IdLote", principalTable: "Lote", principalColumn: "IdLote", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Alimentacion_Usuario_IdAutor", table: "Alimentacion", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_MovimientoAnimal_Animal_IdAnimal", table: "MovimientoAnimal", column: "IdAnimal", principalTable: "Animal", principalColumn: "IdAnimal", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_MovimientoAnimal_Lote_IdLoteDestino", table: "MovimientoAnimal", column: "IdLoteDestino", principalTable: "Lote", principalColumn: "IdLote", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_MovimientoAnimal_Lote_IdLoteOrigen", table: "MovimientoAnimal", column: "IdLoteOrigen", principalTable: "Lote", principalColumn: "IdLote", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_MovimientoAnimal_Usuario_IdAutor", table: "MovimientoAnimal", column: "IdAutor", principalTable: "Usuario", principalColumn: "IdUsuario", onDelete: ReferentialAction.Restrict);
        }

        /// <summary>
        /// Migración irreversible: <see cref="Up"/> convierte claves primarias y foráneas de <c>int</c>
        /// a <c>char(36)</c> (<see cref="Guid"/>) descartando los identificadores enteros originales.
        /// Revertir parcialmente eliminando solo <c>CambioServidor</c> y <c>RegistroSyncServidor</c>
        /// dejaría el esquema inconsistente respecto a la migración inicial; para revertir en producción
        /// se debe restaurar el respaldo previo de la base de datos.
        /// </summary>
        /// <exception cref="NotSupportedException">Siempre lanzada porque la conversión <c>int</c> a <c>Guid</c> no es reversible sin pérdida de identidad.</exception>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "La migración 20261116232038_AddSincronizacionYAuditoriaModels es irreversible: " +
                "la conversión de claves primarias y foráneas de int a char(36) (Guid) descarta los IDs enteros originales. " +
                "Para revertir este cambio, restaure un respaldo previo de la base de datos.");
        }
    }
}
