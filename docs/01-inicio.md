# 01. Inicio y configuración

## Requisitos declarados
- Node.js 24 LTS y npm.
- SDK .NET 10.
- MySQL 8.0 o superior.

El README indica que `global.json` fija SDK `10.0.100` con `rollForward: latestFeature`; confirma el archivo en la rama actual.

## Backend

Desde la raíz:

```bash
dotnet restore FarmBovi.sln --locked-mode
dotnet tool restore
dotnet run --project BackEnd --launch-profile http
```

URLs declaradas: `http://localhost:5080` y Swagger en `http://localhost:5080/swagger`.

## Frontend

Desde `FrontEnd/`:

```bash
npm ci
npm run dev
```

URL declarada: `http://localhost:5173/dashboard`.

## Build y preview

```bash
npm run build
npm run preview
```

La documentación indica `http://localhost:4173`. Ejecuta los comandos desde `FrontEnd/`.

## Validación

La fuente menciona `npm run lint`, `npm run typecheck` y `npm run build`. Comprueba que esos scripts existan en `package.json`. Configura MySQL mediante el mecanismo local del backend; no publiques credenciales ni cadenas de conexión.
