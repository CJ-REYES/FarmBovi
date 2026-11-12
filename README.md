# FarmBovi

Base del proyecto ganadero con **React + TypeScript + Tailwind CSS**, una **PWA** instalable y una **Web API de ASP.NET Core en .NET 10 LTS**. Frontend y backend viven en carpetas separadas.

Incluye una API CRUD para animales, lotes, ranchos, usuarios y asignaciones de usuarios a ranchos. Los datos se guardan en MySQL; contraseñas de usuario se almacenan con hash.

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
├── global.json                 # Selección del SDK .NET 10
└── FarmBovi.sln
```

El código React se guarda en `src`, la abreviatura habitual de *source*.

## Requisitos

- **Node.js 24 LTS** y npm. `.nvmrc` fija la rama 24; Vite necesita al menos Node 22.12 en esta configuración.
- **SDK .NET 10**, actualizado a un parche compatible. `global.json` mantiene la selección dentro de la rama 10 mediante `rollForward: latestFeature`.
- Git. No necesitas instalar un servidor de base de datos para comenzar.


## Backend .NET 10 LTS

FarmBovi usa **.NET 10 LTS** para la API y Entity Framework Core:

| Componente | Configuración del repositorio |
| --- | --- |
| Target framework | `net10.0` |
| Banda base del SDK | `10.0.100` en `global.json` |
| Política del SDK | `rollForward: latestFeature` |
| Entity Framework Core y proveedor MySQL | `10.0.12` |
| Herramienta local `dotnet-ef` | `10.0.14` |
| Base de datos | MySQL |

.NET 10 es una versión LTS. La política oficial de Microsoft indica soporte hasta el **14 de noviembre de 2028**. Mantén .NET 10 y sus parches al día.

### Instalar o actualizar el SDK en Windows

Abre PowerShell o Windows Terminal. Con WinGet:

```powershell
winget install --id Microsoft.DotNet.SDK.10 --exact
```

Para actualizar una instalación existente:

```powershell
winget upgrade --id Microsoft.DotNet.SDK.10 --exact
```

El SDK incluye el runtime de .NET y ASP.NET Core correspondiente; no instales otro runtime por separado para compilar y ejecutar FarmBovi. Si no tienes WinGet, utiliza el instalador del SDK en [Descargar .NET 10](https://dotnet.microsoft.com/download/dotnet/10.0).

Cierra y vuelve a abrir la terminal después de instalar. No necesitas desinstalar .NET 8: varias versiones pueden convivir lado a lado.

### Instalar o actualizar el SDK en Linux

**Arch Linux y derivados (CachyOS y otros sistemas que usan los repositorios de Arch):**

```bash
sudo pacman -Syu dotnet-sdk-10.0
```

El paquete del SDK instala los componentes de ejecución y targeting que necesita mediante sus dependencias. Los paquetes de .NET 10 de Arch están versionados con el sufijo `-10.0`; consulta [los paquetes actuales de dotnet-core-10.0](https://archlinux.org/packages/extra/x86_64/dotnet-core-10.0/). Si `pacman` reporta conflictos con paquetes antiguos sin sufijo o requiere intervención manual, lee el aviso de [migración de paquetes .NET de Arch](https://archlinux.org/news/net-packages-may-require-manual-intervention/) y resuelve los conflictos indicados; no fuerces la instalación con `--overwrite`.

**Otras distribuciones Linux:** utiliza el gestor de paquetes de la distribución o sigue las instrucciones oficiales específicas para ella en [Instalar .NET en Linux](https://learn.microsoft.com/dotnet/core/install/linux). Evita mezclar paquetes de Microsoft con paquetes de la distribución para la misma versión.

### Verificar el SDK y preparar FarmBovi (Windows y Linux)

Desde la raíz del repositorio, ejecuta:

```bash
dotnet --list-sdks
dotnet --list-runtimes
dotnet --version
dotnet restore FarmBovi.sln --locked-mode
dotnet tool restore
dotnet ef --version
dotnet build FarmBovi.sln --configuration Release --no-restore
```

La versión seleccionada por `dotnet --version` debe ser **10.0.x**. El valor `10.0.100` de `global.json` es la banda base, no una exigencia de instalar exactamente ese parche: `latestFeature` permite usar una banda de características posterior dentro de .NET 10. La propiedad `TargetFramework` de `BackEnd/FarmBovi.Api.csproj` define `net10.0`; `global.json` selecciona el SDK utilizado para compilar.

Si aparece el error de que no se encuentra un SDK compatible, confirma que el SDK 10 está instalado, abre una terminal nueva y ejecuta de nuevo `dotnet --list-sdks` desde la raíz de FarmBovi. No basta con instalar únicamente el runtime.

**No desinstales .NET 8 de forma global** si tienes otros proyectos que todavía lo necesitan. La instalación lado a lado es compatible; el `global.json` de cada repositorio determina qué SDK selecciona.

## Arranque rápido

Abre una terminal en la raíz del repositorio:

```bash
dotnet restore FarmBovi.sln
dotnet tool restore
dotnet run --project BackEnd --launch-profile http
```

La API escucha en **http://localhost:5080**. En desarrollo aplica las migraciones MySQL al iniciar. Crea primero la base de datos `farmbovi` y configura `ConnectionStrings:FarmBovi` con las credenciales del servidor. Swagger está en **http://localhost:5080/swagger**.

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
| [API y base de datos](docs/04-api-y-datos.md) | Endpoints CRUD, MySQL y migraciones |
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

Esta base incluye usuarios, varios ranchos y módulos ganaderos. El inicio de sesión está en implementación en esta rama; los permisos detallados por rancho y la sincronización completa siguen pendientes. Antes de exponer la API con datos reales, implementa y valida la autorización por rancho.

Repositorio público: [CJ-REYES/FarmBovi](https://github.com/CJ-REYES/FarmBovi).

## Actividades de autenticación y sincronización

Estas actividades se implementan en tareas pequeñas, cada una en su propia rama `codex/` y con documentación y commit identificables.

| Actividad | Estado | Alcance |
| --- | --- | --- |
| 1. Terminar el inicio de sesión | Implementado en `ea5ca98` | Login con contraseña verificada contra su hash, token JWT de 8 horas, rutas protegidas por defecto, formulario web y cierre de sesión. Las altas de usuarios requieren iniciar sesión. |
| 2. Registrar cambios remotos | Implementado en `26b5e08` | El historial `CambioServidor` guarda altas, ediciones y eliminaciones con entidad, ID, fecha UTC, rancho y datos del registro en la misma transacción. |
| 3. Endpoint para consultar cambios | Implementado en la rama actual | `GET /api/sync/cambios` consulta cambios autorizados por rancho para el usuario autenticado. |
| 4. Paginación y cursor | Implementado en la rama actual | El motor descarga las páginas y guarda cada lote en la bandeja IndexedDB junto con el cursor por usuario, en una transacción local. |
| 5. Enviar borrados | Implementado en la rama actual | El servidor envía eventos `eliminar`; el cliente conserva el tombstone y marca eliminado localmente el registro sincronizado si lo tiene. |

### Configurar autenticación

En desarrollo, si no se define una clave, el backend crea una clave JWT temporal por ejecución; al reiniciarlo, los tokens anteriores expiran. En producción configura `Authentication__SigningKey` como secreto de al menos 32 bytes y no lo guardes en Git. Por ejemplo, en PowerShell:

```powershell
$env:Authentication__SigningKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

El endpoint `POST /api/usuarios/login` acepta `correo` y `contrasena`, y devuelve un token bearer válido por ocho horas. La aplicación conserva el token en `sessionStorage`, lo envía en solicitudes protegidas y permite cerrar sesión. Para crear usuarios se requiere una sesión autenticada.

La autenticación identifica al usuario y el endpoint de cambios filtra por sus asignaciones activas a ranchos. La autorización granular para las demás rutas CRUD sigue pendiente; no publiques el sistema con datos reales hasta implementarla y verificarla.

El endpoint de cambios filtra mediante las asignaciones activas del usuario a ranchos, recibe el cursor opaco como parámetro `cursor` y acepta `limite` entre 1 y 200. La respuesta contiene `cambios`, `cursorSiguiente` y `hayMas`. Cada dispositivo conserva un cursor por usuario y guarda el lote en su bandeja IndexedDB antes de confirmar localmente el cursor. Los tombstones eliminan de forma lógica las filas locales sincronizadas que ya existen. Las altas y ediciones descargadas quedan en la bandeja `serverChanges` para su proyección a los módulos; esa proyección completa y los permisos por rancho del resto de la API siguen pendientes.
