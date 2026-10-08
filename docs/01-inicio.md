# Inicio y configuración

## 1. Revisar las herramientas

```bash
node --version
npm --version
dotnet --list-sdks
git --version
```

Usa Node 24 LTS y un SDK .NET 8 actualizado. Si utilizas nvm, ejecuta `nvm install` y `nvm use` dentro de `FrontEnd`. `global.json` pide un SDK 8.0.100 o posterior de la rama 8; `rollForward: latestFeature` acepta los SDK 8.0.2xx, 8.0.3xx, etc. Un SDK 9 o 10 por sí solo no satisface esta selección.

## 2. Obtener el proyecto

```bash
git clone https://github.com/CJ-REYES/FarmBovi.git
cd FarmBovi
```

Si ya trabajas en la carpeta original `ProyectoGanader`, úsala directamente. El nombre de la carpeta local no tiene que coincidir con el del repositorio.

## 3. Instalar dependencias

Desde la raíz:

```bash
dotnet restore FarmBovi.sln
dotnet tool restore
```

Después, desde el frontend:

```bash
cd FrontEnd
npm ci
```

`npm ci` instala lo fijado en el lockfile sin modificarlo. Para añadir una dependencia se usa `npm install nombre-paquete`; esto actualiza tanto `package.json` como `package-lock.json`. Ambos cambios se suben a Git.

## 4. Iniciar dos procesos

En una terminal, desde la raíz:

```bash
dotnet watch --project BackEnd run --launch-profile http
```

En otra, desde `FrontEnd`:

```bash
npm run dev
```

`dotnet watch` y Vite recargan el proyecto mientras editas. Detén cada proceso con `Ctrl+C`.

| Servicio | Dirección | Propósito |
| --- | --- | --- |
| API | http://localhost:5080/api/cattle | Datos del ganado |
| Swagger | http://localhost:5080/swagger | Explorar y ejecutar la API |
| Health | http://localhost:5080/health | Comprobar conexión a SQLite |
| React en desarrollo | http://localhost:5173 | Editar la interfaz |
| React compilado | http://localhost:4173 | Inspeccionar la PWA local |

Los puertos del frontend son estrictos: Vite avisa si están ocupados, para que no arranque en un puerto distinto al documentado.

## 5. Configuración del frontend

La configuración funciona con valores predeterminados. Para cambiarlos, copia `FrontEnd/.env.example` como `FrontEnd/.env`:

```dotenv
VITE_API_BASE_URL=/api
API_PROXY_TARGET=http://localhost:5080
```

- `VITE_API_BASE_URL`: dirección visible en el navegador. `/api` usa el mismo origen que el frontend. Para una API en otro servidor, usa una URL completa como `https://api.ejemplo.com/api`.
- `API_PROXY_TARGET`: servidor al que Vite reenvía `/api` durante desarrollo y preview. No crea un proxy en producción.

Vite incorpora las variables `VITE_` en el build: son públicas. Guarda contraseñas y claves en el backend. Reinicia Vite después de editar `.env` y recompila si cambias una variable para producción.

## 6. Configuración del backend

`appsettings.json` contiene los valores generales y `appsettings.Development.json` los del entorno local. El perfil `http` activa `Development` y aplica las migraciones pendientes al iniciar.

Para sobreescribir valores mediante variables de entorno, reemplaza `:` por `__`:

```bash
export ConnectionStrings__FarmBovi='Data Source=/ruta/persistente/farmbovi.db'
export Cors__AllowedOrigins__0='https://app.ejemplo.com'
```

En PowerShell:

```powershell
$env:ConnectionStrings__FarmBovi = 'Data Source=C:/datos/farmbovi.db'
$env:Cors__AllowedOrigins__0 = 'https://app.ejemplo.com'
```

La carpeta que contenga una ruta de base personalizada debe existir y ser escribible por el proceso de la API. La ruta predeterminada `App_Data/farmbovi.db` se resuelve desde la carpeta de la API y se crea automáticamente.

Para secretos futuros puedes usar `dotnet user-secrets init --project BackEnd` y después `dotnet user-secrets set --project BackEnd Clave Valor`. El almacén de secretos es para desarrollo; en producción usa el gestor de secretos de tu servidor.

## 7. HTTPS local opcional

```bash
dotnet dev-certs https --trust
dotnet run --project BackEnd --launch-profile https
```

El perfil HTTPS añade `https://localhost:7080`. La confianza del certificado depende del sistema operativo y del navegador. El flujo inicial usa HTTP en localhost, que permite probar service workers sin configurar certificados. Para un teléfono consulta la guía de publicación.

## Herramientas de editor

Puedes abrir `FarmBovi.sln` en Visual Studio o la carpeta completa en VS Code. Las extensiones recomendadas están en `.vscode/extensions.json`. El archivo `BackEnd/FarmBovi.Api.http` permite ejecutar peticiones desde un editor compatible; algunas escriben o eliminan registros y están identificadas.
