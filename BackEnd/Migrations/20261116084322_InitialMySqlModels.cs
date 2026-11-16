using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FarmBovi.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialMySqlModels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Usuario",
                columns: table => new
                {
                    IdUsuario = table.Column<Guid>(type: "char(36)", nullable: false),
                    Nombre = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    Correo = table.Column<string>(type: "varchar(254)", maxLength: 254, nullable: false),
                    Contrasena = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: false),
                    Estado = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Usuario", x => x.IdUsuario);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Rancho",
                columns: table => new
                {
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    Nombre = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    UbicacionGeneral = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: false),
                    Estado = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Rancho", x => x.IdRancho);
                    table.ForeignKey(
                        name: "FK_Rancho_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Lote",
                columns: table => new
                {
                    IdLote = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    Nombre = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    Ubicacion = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: true),
                    Estado = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Lote", x => x.IdLote);
                    table.ForeignKey(
                        name: "FK_Lote_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Lote_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "UsuarioRancho",
                columns: table => new
                {
                    IdUsuarioRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdUsuario = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    Rol = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    Estado = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    FechaAlta = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    FechaBaja = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UsuarioRancho", x => x.IdUsuarioRancho);
                    table.ForeignKey(
                        name: "FK_UsuarioRancho_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UsuarioRancho_Usuario_IdUsuario",
                        column: x => x.IdUsuario,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Animal",
                columns: table => new
                {
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdLote = table.Column<Guid>(type: "char(36)", nullable: true),
                    Arete = table.Column<string>(type: "varchar(50)", maxLength: 50, nullable: false),
                    Raza = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    Sexo = table.Column<string>(type: "varchar(15)", maxLength: 15, nullable: false),
                    FechaNacimiento = table.Column<DateTime>(type: "date", nullable: true),
                    FechaIngreso = table.Column<DateTime>(type: "date", nullable: false),
                    Procedencia = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: false),
                    Estado = table.Column<string>(type: "varchar(25)", maxLength: 25, nullable: false),
                    FechaSalida = table.Column<DateTime>(type: "date", nullable: true),
                    Observaciones = table.Column<string>(type: "longtext", nullable: true),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Animal", x => x.IdAnimal);
                    table.ForeignKey(
                        name: "FK_Animal_Lote_IdLote",
                        column: x => x.IdLote,
                        principalTable: "Lote",
                        principalColumn: "IdLote",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Animal_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Animal_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Alimentacion",
                columns: table => new
                {
                    IdAlimentacion = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: true),
                    IdLote = table.Column<Guid>(type: "char(36)", nullable: true),
                    Alimento = table.Column<string>(type: "varchar(150)", maxLength: 150, nullable: false),
                    Racion = table.Column<string>(type: "varchar(150)", maxLength: 150, nullable: false),
                    Cantidad = table.Column<decimal>(type: "decimal(10,3)", precision: 10, scale: 3, nullable: false),
                    Unidad = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    Frecuencia = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    Inicio = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Fin = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CambioDieta = table.Column<string>(type: "longtext", nullable: true),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Alimentacion", x => x.IdAlimentacion);
                    table.ForeignKey(
                        name: "FK_Alimentacion_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Alimentacion_Lote_IdLote",
                        column: x => x.IdLote,
                        principalTable: "Lote",
                        principalColumn: "IdLote",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Alimentacion_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "EventoSanitario",
                columns: table => new
                {
                    IdEventoSanitario = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: false),
                    Tipo = table.Column<string>(type: "varchar(35)", maxLength: 35, nullable: false),
                    Fecha = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Sintomas = table.Column<string>(type: "longtext", nullable: true),
                    Diagnostico = table.Column<string>(type: "longtext", nullable: true),
                    ProfesionalDiagnostico = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: true),
                    EvidenciaDiagnosticoUri = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    Responsable = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    Observaciones = table.Column<string>(type: "longtext", nullable: true),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventoSanitario", x => x.IdEventoSanitario);
                    table.ForeignKey(
                        name: "FK_EventoSanitario_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EventoSanitario_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "MovimientoAnimal",
                columns: table => new
                {
                    IdMovimiento = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdLoteOrigen = table.Column<Guid>(type: "char(36)", nullable: true),
                    IdLoteDestino = table.Column<Guid>(type: "char(36)", nullable: true),
                    Tipo = table.Column<string>(type: "varchar(30)", maxLength: 30, nullable: false),
                    Fecha = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    OrigenExterno = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: true),
                    DestinoExterno = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: true),
                    Motivo = table.Column<string>(type: "longtext", nullable: true),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MovimientoAnimal", x => x.IdMovimiento);
                    table.ForeignKey(
                        name: "FK_MovimientoAnimal_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MovimientoAnimal_Lote_IdLoteDestino",
                        column: x => x.IdLoteDestino,
                        principalTable: "Lote",
                        principalColumn: "IdLote",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MovimientoAnimal_Lote_IdLoteOrigen",
                        column: x => x.IdLoteOrigen,
                        principalTable: "Lote",
                        principalColumn: "IdLote",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MovimientoAnimal_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Tratamiento",
                columns: table => new
                {
                    IdTratamiento = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdEventoSanitario = table.Column<Guid>(type: "char(36)", nullable: false),
                    Producto = table.Column<string>(type: "varchar(150)", maxLength: 150, nullable: false),
                    Dosis = table.Column<decimal>(type: "decimal(10,3)", precision: 10, scale: 3, nullable: false),
                    UnidadDosis = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    ViaAdministracion = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: true),
                    Frecuencia = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    FechaInicio = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    FechaFin = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    Responsable = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    PrescripcionUri = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    Estado = table.Column<string>(type: "varchar(25)", maxLength: 25, nullable: false),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tratamiento", x => x.IdTratamiento);
                    table.ForeignKey(
                        name: "FK_Tratamiento_EventoSanitario_IdEventoSanitario",
                        column: x => x.IdEventoSanitario,
                        principalTable: "EventoSanitario",
                        principalColumn: "IdEventoSanitario",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Tratamiento_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "Recordatorio",
                columns: table => new
                {
                    IdRecordatorio = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdRancho = table.Column<Guid>(type: "char(36)", nullable: false),
                    IdAnimal = table.Column<Guid>(type: "char(36)", nullable: true),
                    IdLote = table.Column<Guid>(type: "char(36)", nullable: true),
                    IdTratamiento = table.Column<Guid>(type: "char(36)", nullable: true),
                    IdResponsable = table.Column<Guid>(type: "char(36)", nullable: true),
                    Tipo = table.Column<string>(type: "varchar(35)", maxLength: 35, nullable: false),
                    Descripcion = table.Column<string>(type: "varchar(250)", maxLength: 250, nullable: false),
                    FechaProgramada = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Estado = table.Column<string>(type: "varchar(25)", maxLength: 25, nullable: false),
                    FechaCompletado = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    IdAutor = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VersionRegistro = table.Column<long>(type: "bigint", nullable: false),
                    EliminadoEn = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recordatorio", x => x.IdRecordatorio);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Animal_IdAnimal",
                        column: x => x.IdAnimal,
                        principalTable: "Animal",
                        principalColumn: "IdAnimal",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Lote_IdLote",
                        column: x => x.IdLote,
                        principalTable: "Lote",
                        principalColumn: "IdLote",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Rancho_IdRancho",
                        column: x => x.IdRancho,
                        principalTable: "Rancho",
                        principalColumn: "IdRancho",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Tratamiento_IdTratamiento",
                        column: x => x.IdTratamiento,
                        principalTable: "Tratamiento",
                        principalColumn: "IdTratamiento",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Usuario_IdAutor",
                        column: x => x.IdAutor,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Recordatorio_Usuario_IdResponsable",
                        column: x => x.IdResponsable,
                        principalTable: "Usuario",
                        principalColumn: "IdUsuario",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_Alimentacion_IdAnimal",
                table: "Alimentacion",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_Alimentacion_IdAutor",
                table: "Alimentacion",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_Alimentacion_IdLote",
                table: "Alimentacion",
                column: "IdLote");

            migrationBuilder.CreateIndex(
                name: "IX_Animal_IdAutor",
                table: "Animal",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_Animal_IdLote",
                table: "Animal",
                column: "IdLote");

            migrationBuilder.CreateIndex(
                name: "IX_Animal_IdRancho_Arete",
                table: "Animal",
                columns: new[] { "IdRancho", "Arete" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EventoSanitario_IdAnimal",
                table: "EventoSanitario",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_EventoSanitario_IdAutor",
                table: "EventoSanitario",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_Lote_IdAutor",
                table: "Lote",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_Lote_IdRancho_Nombre",
                table: "Lote",
                columns: new[] { "IdRancho", "Nombre" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MovimientoAnimal_Fecha",
                table: "MovimientoAnimal",
                column: "Fecha");

            migrationBuilder.CreateIndex(
                name: "IX_MovimientoAnimal_IdAnimal",
                table: "MovimientoAnimal",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_MovimientoAnimal_IdAutor",
                table: "MovimientoAnimal",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_MovimientoAnimal_IdLoteDestino",
                table: "MovimientoAnimal",
                column: "IdLoteDestino");

            migrationBuilder.CreateIndex(
                name: "IX_MovimientoAnimal_IdLoteOrigen",
                table: "MovimientoAnimal",
                column: "IdLoteOrigen");

            migrationBuilder.CreateIndex(
                name: "IX_Rancho_IdAutor",
                table: "Rancho",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_FechaProgramada",
                table: "Recordatorio",
                column: "FechaProgramada");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdAnimal",
                table: "Recordatorio",
                column: "IdAnimal");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdAutor",
                table: "Recordatorio",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdLote",
                table: "Recordatorio",
                column: "IdLote");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdRancho",
                table: "Recordatorio",
                column: "IdRancho");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdResponsable",
                table: "Recordatorio",
                column: "IdResponsable");

            migrationBuilder.CreateIndex(
                name: "IX_Recordatorio_IdTratamiento",
                table: "Recordatorio",
                column: "IdTratamiento");

            migrationBuilder.CreateIndex(
                name: "IX_Tratamiento_IdAutor",
                table: "Tratamiento",
                column: "IdAutor");

            migrationBuilder.CreateIndex(
                name: "IX_Tratamiento_IdEventoSanitario",
                table: "Tratamiento",
                column: "IdEventoSanitario");

            migrationBuilder.CreateIndex(
                name: "IX_Usuario_Correo",
                table: "Usuario",
                column: "Correo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UsuarioRancho_IdRancho",
                table: "UsuarioRancho",
                column: "IdRancho");

            migrationBuilder.CreateIndex(
                name: "IX_UsuarioRancho_IdUsuario_IdRancho",
                table: "UsuarioRancho",
                columns: new[] { "IdUsuario", "IdRancho" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Alimentacion");

            migrationBuilder.DropTable(
                name: "MovimientoAnimal");

            migrationBuilder.DropTable(
                name: "Recordatorio");

            migrationBuilder.DropTable(
                name: "UsuarioRancho");

            migrationBuilder.DropTable(
                name: "Tratamiento");

            migrationBuilder.DropTable(
                name: "EventoSanitario");

            migrationBuilder.DropTable(
                name: "Animal");

            migrationBuilder.DropTable(
                name: "Lote");

            migrationBuilder.DropTable(
                name: "Rancho");

            migrationBuilder.DropTable(
                name: "Usuario");
        }
    }
}
