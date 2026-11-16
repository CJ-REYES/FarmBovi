# FarmBovi

Plataforma ganadera **offline-first** concebida como una **Progressive Web App (PWA) instalable**. La documentación base describe React 19, TypeScript, Vite 8, Tailwind CSS 4, Dexie 4/IndexedDB, ASP.NET Core .NET 10, Entity Framework Core 10 y MySQL.

> **Alcance y precisión:** estos documentos se redactaron a partir del README adjunto y de la bitácora técnica compartida. No constituyen una auditoría independiente del repositorio en esta sesión. Las funciones descritas deben contrastarse con el código y las pruebas de la rama antes de considerarlas verificadas.

## Objetivo

Permitir registrar hato, trazabilidad, pesajes y actividades ganaderas en campo sin conexión y en oficina, conservando cambios localmente y sincronizándolos con el servidor cuando vuelva la conectividad.

## Tecnologías declaradas

| Área | Tecnología |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7 |
| PWA | vite-plugin-pwa 2, Workbox 7, `injectManifest` |
| Persistencia local | Dexie 4 sobre IndexedDB |
| Backend | ASP.NET Core / .NET 10 |
| ORM | Entity Framework Core 10 |
| Base de datos | MySQL 8.0+ |

## Arquitectura

```mermaid
flowchart LR
 U[Usuario] --> UI[React]
 UI --> R[Repositorios Dexie]
 R <--> IDB[(IndexedDB)]
 IDB --> O[Outbox y medios]
 S[SyncScheduler] --> E[Push / Pull / Conflictos]
 E --> API[ASP.NET Core]
 API --> EF[EF Core]
 EF --> DB[(MySQL)]
 SW[Service Worker] -. App Shell y assets .-> UI
```

## Estructura conceptual

```text
FarmBovi/
├── FrontEnd/
│   ├── public/manifest.webmanifest
│   ├── src/pwa/
│   ├── src/lib/database/
│   ├── src/services/
│   ├── src/hooks/
│   ├── src/components/
│   ├── src/App.tsx
│   └── vite.config.ts
├── BackEnd/
│   ├── Controllers/
│   ├── Data/
│   ├── DTOs/
│   ├── Models/
│   └── Migrations/
├── BackEnd.Tests/
└── docs/
```

La estructura es orientativa y debe cotejarse con el árbol real de la rama.

## Requisitos y ejecución

Requisitos declarados: Node.js 24 LTS, npm, SDK .NET 10 y MySQL 8.0+.

Backend, desde la raíz:

```bash
dotnet restore FarmBovi.sln --locked-mode
dotnet tool restore
dotnet run --project BackEnd --launch-profile http
```

La fuente indica API en `http://localhost:5080` y Swagger en `http://localhost:5080/swagger`.

Frontend, desde otra terminal:

```bash
cd FrontEnd
npm ci
npm run dev
```

URL indicada: `http://localhost:5173/dashboard`.

Build y preview:

```bash
cd FrontEnd
npm run build
npm run preview
```

URL indicada: `http://localhost:4173`.

## Estado y limitaciones declaradas

El README fuente declara implementados frontend, PWA, IndexedDB y motores offline, y menciona validaciones `lint`, `typecheck` y `build`. También declara diez controladores REST. Sin embargo, identifica como pendientes la sincronización remota del servidor (`POST /api/sync/push` y `GET /api/sync/pull`) y el proxy de IA de BoviScale. La bitácora también señala autenticación/autorización, aislamiento por rancho, carga multimedia y pruebas reales en Android/iOS como asuntos por completar.

No debe confundirse una arquitectura cliente preparada con sincronización remota ya operativa.

## Índice

- [01. Inicio y configuración](docs/01-inicio.md)
- [02. Arquitectura](docs/02-arquitectura.md)
- [03. Frontend](docs/03-frontend.md)
- [04. Backend](docs/04-backend.md)
- [05. Base de datos](docs/05-base-de-datos.md)
- [06. PWA](docs/06-pwa.md)
- [07. Offline-First](docs/07-offline-first.md)
- [08. Sincronización](docs/08-sincronizacion.md)
- [09. BoviScale](docs/09-boviscale.md)
- [10. Permisos y dispositivos](docs/10-permisos-y-dispositivos.md)
- [11. Seguridad](docs/11-seguridad.md)
- [12. Problemas y soluciones](docs/12-problemas-y-soluciones.md)
- [13. Validación y pruebas](docs/13-validacion-y-pruebas.md)
- [14. Historial de desarrollo](docs/14-historial-desarrollo.md)
- [15. Inventario de cambios](docs/15-inventario-cambios.md)
- [16. Decisiones técnicas](docs/16-decisiones-tecnicas.md)

Repositorio: https://github.com/CJ-REYES/FarmBovi
