# FarmBovi

Base del proyecto ganadero con **React + TypeScript + Tailwind CSS**, una **PWA** instalable y una **Web API de ASP.NET Core en .NET 8**. Frontend y backend viven en carpetas separadas.

Incluye un primer módulo de bovinos para aprender cómo se conectan las dos aplicaciones: registrar, listar, buscar, editar y eliminar animales. Los datos se guardan en SQLite; cada arete es único. La base comienza vacía, sin registros ficticios.

## Estructura

```text
FarmBovi/
├── FrontEnd/
│   ├── public/                  # Iconos de la PWA
│   ├── src/
│   │   ├── components/          # Formulario y avisos PWA
│   │   ├── hooks/               # Datos, conexión e instalación
│   │   ├── lib/                 # Cliente HTTP y copia local
│   │   ├── types/               # Contratos TypeScript
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── vite.config.ts           # Tailwind, proxy, manifest y service worker
├── BackEnd/
│   ├── Controllers/             # Endpoints HTTP
│   ├── Data/                    # DbContext y comprobación de base de datos
│   ├── DTOs/                    # Entrada, validación y respuesta
│   ├── Models/                  # Entidades
│   ├── Migrations/              # Evolución versionada del esquema
│   ├── Properties/              # Perfiles de ejecución
│   ├── Program.cs
│   └── FarmBovi.Api.csproj
├── docs/                       # Guías en español
├── scripts/                    # Generación de iconos y publicación
├── .config/dotnet-tools.json    # Herramienta EF Core local
├── .github/workflows/           # Compilación automática
├── .gitignore
├── global.json                 # Selección del SDK .NET 8
└── FarmBovi.sln
```

El código React se guarda en `src`, la abreviatura habitual de *source*.

## Requisitos

- **Node.js 24 LTS** y npm. `.nvmrc` fija la rama 24; Vite necesita al menos Node 22.12 en esta configuración.
- **SDK .NET 8**, actualizado a su último parche disponible. `global.json` mantiene el proyecto en la rama 8.
- Git. No necesitas instalar un servidor de base de datos para comenzar.

## Arranque rápido

Abre una terminal en la raíz del repositorio:

```bash
dotnet restore FarmBovi.sln
dotnet tool restore
dotnet run --project BackEnd --launch-profile http
```

La API escucha en **http://localhost:5080**. En desarrollo aplica la migración inicial y crea `BackEnd/App_Data/farmbovi.db` automáticamente. Swagger está en **http://localhost:5080/swagger**.

En otra terminal:

```bash
cd FrontEnd
npm ci
npm run dev
```

Abre **http://localhost:5173**. Vite envía las peticiones `/api` al backend. La configuración predeterminada funciona sin crear un archivo `.env`; `FrontEnd/.env.example` explica cómo cambiarla.

## Abrir la PWA

El service worker se genera al compilar; está deshabilitado durante `npm run dev` para evitar cachés de desarrollo. Con la API todavía encendida, ejecuta desde `FrontEnd`:

```bash
npm run build
npm run preview
```

Abre **http://localhost:4173**, consulta el ganado y espera el aviso de disponibilidad sin conexión. Puedes instalar la app cuando el navegador lo permita. En un teléfono necesitas una dirección **HTTPS**; `http://IP-de-tu-computadora` no cumple el requisito.

**Sin conexión:** la app puede abrirse después de una primera carga completa y mostrar el último listado guardado en ese navegador. Indica la fecha de la copia y deshabilita las modificaciones. Esta primera versión no guarda altas, ediciones o eliminaciones pendientes de sincronizar.

## Documentación

| Guía | Qué explica |
| --- | --- |
| [Inicio y configuración](docs/01-inicio.md) | Instalación, terminales, puertos, variables y comandos |
| [Arquitectura](docs/02-arquitectura.md) | Responsabilidad de cada carpeta y recorrido de una petición |
| [Tu primera PWA](docs/03-pwa.md) | Manifest, service worker, instalación, cachés y actualizaciones |
| [API y base de datos](docs/04-api-y-datos.md) | Endpoints, validación, SQLite y migraciones |
| [Publicación](docs/05-publicacion.md) | Build, HTTPS, persistencia, CORS y GitHub |
| [Solución de problemas](docs/06-problemas.md) | Errores habituales y cómo resolverlos |
| [Estado de validación](docs/07-validacion.md) | Comprobaciones realizadas y pendientes |

## Comandos de mantenimiento

Desde `FrontEnd`:

```bash
npm run lint
npm run typecheck
npm run build
```

Desde la raíz:

```bash
dotnet restore FarmBovi.sln --locked-mode
dotnet build FarmBovi.sln --configuration Release --no-restore
```

`package-lock.json`, `packages.lock.json` y el manifiesto de herramientas fijan las dependencias. GitHub Actions ejecuta la compilación y las comprobaciones del frontend en cada push o pull request.

## Alcance inicial

Esta base tiene un solo registro de ganado. Autenticación, usuarios, varios ranchos, pesajes, vacunas, reproducción, permisos y sincronización de escrituras sin conexión son siguientes módulos, todavía no implementados. Antes de exponer la API con datos reales, incorpora autenticación y autorización.

Repositorio público: [CJ-REYES/FarmBovi](https://github.com/CJ-REYES/FarmBovi).
