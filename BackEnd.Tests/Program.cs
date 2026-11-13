using FarmBovi.Api.Controllers;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

var checks = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException($"FALLÓ: {description}");
    checks++;
}
FarmDbContext CreateDb() => new(new DbContextOptionsBuilder<FarmDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

await using (var db = CreateDb())
{
    var c = new RanchosController(db);
    var result = await c.Create(new Rancho { Nombre="Rancho", UbicacionGeneral="Norte", Estado="Activo" }, default);
    var item = (Rancho)((CreatedAtActionResult)result.Result!).Value!;
    Check(item.VersionRegistro == 1, "Rancho POST configura versión inicial");
    Check((await c.GetAll(default)).Count == 1, "Rancho GET colección");
    Check((await c.Get(item.IdRancho, default)).Result is OkObjectResult, "Rancho GET por id");
    Check(await c.Update(item.IdRancho, new Rancho { Nombre="Rancho 2", UbicacionGeneral="Sur", Estado="Activo" }, default) is NoContentResult, "Rancho PUT");
    Check(await c.Delete(item.IdRancho, default) is NoContentResult, "Rancho DELETE");
    Check((await c.Get(item.IdRancho, default)).Result is NotFoundResult, "Rancho retorna 404 al eliminar");
}
await using (var db = CreateDb())
{
    var c = new LotesController(db);
    var result = await c.Create(new Lote { IdRancho=1, Nombre="Lote", Estado="Activo" }, default);
    var item = (Lote)((CreatedAtActionResult)result.Result!).Value!;
    Check((await c.GetAll(default)).Count == 1, "Lote GET colección");
    Check((await c.Get(item.IdLote, default)).Result is OkObjectResult, "Lote GET por id");
    Check(await c.Update(item.IdLote, new Lote { IdRancho=1, Nombre="Lote 2", Estado="Activo" }, default) is NoContentResult, "Lote PUT");
    Check(await c.Delete(item.IdLote, default) is NoContentResult, "Lote DELETE");
}
await using (var db = CreateDb())
{
    var c = new AnimalsController(db);
    var result = await c.Create(new Animal { IdRancho=1, IdLote=1, Arete="MX-1", Raza="Holstein", Sexo="Hembra", Estado="Activo" }, default);
    var item = (Animal)((CreatedAtActionResult)result.Result!).Value!;
    Check(item.VersionRegistro == 1, "Animal POST configura versión inicial");
    Check((await c.GetAll(default)).Count == 1, "Animal GET colección");
    Check((await c.Get(item.IdAnimal, default)).Result is OkObjectResult, "Animal GET por id");
    Check(await c.Update(item.IdAnimal, new Animal { IdRancho=1, IdLote=1, Arete="MX-2", Raza="Holstein", Sexo="Hembra", Estado="Activo" }, default) is NoContentResult, "Animal PUT");
    Check(item.VersionRegistro == 2, "Animal PUT incrementa versión");
    Check(await c.Delete(item.IdAnimal, default) is NoContentResult, "Animal DELETE");
}
await using (var db = CreateDb())
{
    var c = new UsuarioController(db);
    var result = await c.Create(new UsuarioRequest("Ana", "ANA@example.com", "password123", "Activo"), default);
    var item = (UsuarioResponse)((CreatedAtActionResult)result.Result!).Value!;
    Check((await c.GetAll(default)).Value!.Count == 1, "Usuario GET colección");
    Check(!System.Text.Json.JsonSerializer.Serialize(item).Contains("password", StringComparison.OrdinalIgnoreCase), "Usuario no expone contraseña");
    Check((await db.Usuarios.SingleAsync()).Contrasena != "password123", "Usuario guarda hash de contraseña");
    Check((await c.Get(item.Id, default)).Result is OkObjectResult, "Usuario GET por id");
    Check(await c.Update(item.Id, new UsuarioRequest("Ana 2", "ana@example.com", null, "Activo"), default) is NoContentResult, "Usuario PUT");
    Check(await c.Delete(item.Id, default) is NoContentResult, "Usuario DELETE");
}
await using (var db = CreateDb())
{
    var c = new UsuarioRanchosController(db);
    var result = await c.Create(new UsuarioRancho { IdUsuario=1, IdRancho=1, Rol="Admin", Estado="Activo" }, default);
    var item = (UsuarioRancho)((CreatedAtActionResult)result.Result!).Value!;
    Check((await c.GetAll(default)).Count == 1, "UsuarioRancho GET colección");
    Check((await c.Get(item.IdUsuarioRancho, default)).Result is OkObjectResult, "UsuarioRancho GET por id");
    Check(await c.Update(item.IdUsuarioRancho, new UsuarioRancho { IdUsuario=1, IdRancho=1, Rol="Operador", Estado="Activo" }, default) is NoContentResult, "UsuarioRancho PUT");
    Check(await c.Delete(item.IdUsuarioRancho, default) is NoContentResult, "UsuarioRancho DELETE");
}
await using (var db = CreateDb())
{
    var eventos = new EventosSanitariosController(db);
    var createEv = await eventos.Create(new EventoSanitario
    {
        IdAnimal = 1,
        Tipo = "Vacunación",
        Fecha = DateTime.UtcNow,
        Diagnostico = "Preventivo",
        ProfesionalDiagnostico = "MVZ Carlos",
        Responsable = "Juan Pérez",
        IdAutor = 1
    }, default);
    var ev = (EventoSanitario)((CreatedAtActionResult)createEv.Result!).Value!;
    Check(ev.VersionRegistro == 1, "EventoSanitario POST configura versión inicial");
    Check((await eventos.GetAll(default)).Count == 1, "EventoSanitario GET colección");
    Check((await eventos.Get(ev.IdEventoSanitario, default)).Result is OkObjectResult, "EventoSanitario GET por id");
    Check(await eventos.Update(ev.IdEventoSanitario, new EventoSanitario
    {
        IdAnimal = 1,
        Tipo = "Revisión",
        Fecha = DateTime.UtcNow,
        Responsable = "Juan Pérez",
        IdAutor = 1
    }, default) is NoContentResult, "EventoSanitario PUT");
    Check(ev.VersionRegistro == 2, "EventoSanitario PUT incrementa versión");

    var tratamientos = new TratamientosController(db);
    var createTr = await tratamientos.Create(new Tratamiento
    {
        IdEventoSanitario = ev.IdEventoSanitario,
        Producto = "Ivermectina 1%",
        Dosis = 5.5m,
        UnidadDosis = "ml",
        ViaAdministracion = "Subcutánea",
        Frecuencia = "Dosis única",
        FechaInicio = DateTime.UtcNow,
        Responsable = "Juan Pérez",
        Estado = "En curso",
        IdAutor = 1
    }, default);
    var tr = (Tratamiento)((CreatedAtActionResult)createTr.Result!).Value!;
    Check(tr.VersionRegistro == 1, "Tratamiento POST configura versión inicial");
    Check((await tratamientos.GetAll(default)).Count == 1, "Tratamiento GET colección");
    Check((await tratamientos.Get(tr.IdTratamiento, default)).Result is OkObjectResult, "Tratamiento GET por id");
    Check(await tratamientos.Update(tr.IdTratamiento, new Tratamiento
    {
        IdEventoSanitario = ev.IdEventoSanitario,
        Producto = "Ivermectina 1%",
        Dosis = 6.0m,
        UnidadDosis = "ml",
        Frecuencia = "Cada 24h",
        FechaInicio = DateTime.UtcNow,
        Responsable = "Juan Pérez",
        Estado = "Completado",
        IdAutor = 1
    }, default) is NoContentResult, "Tratamiento PUT");
    Check(tr.VersionRegistro == 2, "Tratamiento PUT incrementa versión");

    var recordatorios = new RecordatoriosController(db);
    // Regla 12: Animal y Lote son excluyentes
    var invalidRec = await recordatorios.Create(new Recordatorio
    {
        IdRancho = 1,
        IdAnimal = 1,
        IdLote = 1,
        Tipo = "Vacunación",
        Descripcion = "Invalido",
        FechaProgramada = DateTime.UtcNow.AddDays(7),
        Estado = "Pendiente",
        IdAutor = 1
    }, default);
    Check(invalidRec.Result is BadRequestObjectResult, "Recordatorio rechaza animal y lote simultáneos (Regla 12)");

    var createRec = await recordatorios.Create(new Recordatorio
    {
        IdRancho = 1,
        IdAnimal = 1,
        IdTratamiento = tr.IdTratamiento,
        Tipo = "Refuerzo",
        Descripcion = "Aplicar refuerzo",
        FechaProgramada = DateTime.UtcNow.AddDays(7),
        Estado = "Pendiente",
        IdAutor = 1
    }, default);
    var rec = (Recordatorio)((CreatedAtActionResult)createRec.Result!).Value!;
    Check(rec.VersionRegistro == 1, "Recordatorio POST configura versión inicial");
    Check((await recordatorios.GetAll(default)).Count == 1, "Recordatorio GET colección");
    Check((await recordatorios.Get(rec.IdRecordatorio, default)).Result is OkObjectResult, "Recordatorio GET por id");
    Check(await recordatorios.Update(rec.IdRecordatorio, new Recordatorio
    {
        IdRancho = 1,
        IdAnimal = 1,
        IdTratamiento = tr.IdTratamiento,
        Tipo = "Refuerzo",
        Descripcion = "Aplicar refuerzo completado",
        FechaProgramada = DateTime.UtcNow.AddDays(7),
        Estado = "Completado",
        IdAutor = 1
    }, default) is NoContentResult, "Recordatorio PUT");
    Check(rec.FechaCompletado is not null, "Recordatorio completado asigna FechaCompletado (Regla 13)");
    Check(await recordatorios.Delete(rec.IdRecordatorio, default) is NoContentResult, "Recordatorio DELETE");
    Check(await tratamientos.Delete(tr.IdTratamiento, default) is NoContentResult, "Tratamiento DELETE");
    Check(await eventos.Delete(ev.IdEventoSanitario, default) is NoContentResult, "EventoSanitario DELETE");
}

Console.WriteLine($"Correcto: {checks} comprobaciones CRUD de controladores.");
