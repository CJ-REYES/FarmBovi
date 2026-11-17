# 04. Backend

## Tecnología y función
La fuente describe ASP.NET Core sobre .NET 10, Entity Framework Core 10 y MySQL. El servidor debe validar y persistir la información, aplicar reglas de negocio y controlar acceso.

## Controladores enumerados en el README
1. `AnimalsController`
2. `LotesController`
3. `RanchosController`
4. `UsuarioController`
5. `UsuarioRanchosController`
6. `MovimientoAnimalController`
7. `AlimentacionController`
8. `EventosSanitariosController`
9. `TratamientosController`
10. `RecordatoriosController`

Confirma nombres y rutas en `BackEnd/Controllers`.

## Ruta de animales
La documentación identifica `/api/animales` como ruta de comprobación de conectividad. La bitácora atribuye al controlador alta automática de movimiento, incremento de `VersionRegistro` al editar y borrado lógico mediante `EliminadoEn`; verifica estas reglas en código.

## Pendientes declarados
- `POST /api/sync/push`.
- `GET /api/sync/pull`.
- Autenticación/autorización y aislamiento por rancho.
- Carga multipart de medios.
- Proxy seguro de IA para BoviScale.

Las pruebas CRUD con EF Core InMemory no demuestran por sí solas integración real con MySQL, seguridad ni sincronización.
