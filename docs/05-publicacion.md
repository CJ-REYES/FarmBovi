# Publicación

Subir el código a GitHub y publicar la aplicación son acciones distintas. El repositorio `FarmBovi` contiene fuentes y documentación. Para usar la PWA en un teléfono debes alojar el build en un servidor HTTPS y tener una API accesible.

## Opción A: frontend y API en el mismo origen

Es la configuración más sencilla para empezar: `/` sirve React y `/api` sirve la API. El proyecto permite copiar el build a `wwwroot` de la publicación ASP.NET Core.

Desde la raíz, en Linux o macOS:

```bash
bash scripts/publish.sh
```

En PowerShell:

```powershell
./scripts/publish.ps1
```

Los scripts instalan las dependencias fijadas, compilan el frontend, publican la API y copian `FrontEnd/dist` a `artifacts/publish/wwwroot`. Revisa que no tengas un `VITE_API_BASE_URL` absoluto para otro servidor; el valor `/api` funciona en el mismo origen.

Procedimiento equivalente, útil para ver cada paso:

```bash
cd FrontEnd
npm ci
npm run build
cd ..
dotnet publish BackEnd --configuration Release --output artifacts/publish
mkdir -p artifacts/publish/wwwroot
cp -R FrontEnd/dist/. artifacts/publish/wwwroot/
```

Despliega el contenido de `artifacts/publish` en un host compatible con ASP.NET Core .NET 8. La API contiene `UseDefaultFiles` y `UseStaticFiles` para servir estos archivos. La pantalla inicial se sirve en `/`; esta base no tiene rutas de React Router ni una regla general que convierta errores de API en HTML.

Configura el entorno `Production`, una base SQLite en disco persistente y HTTPS. Aplica las migraciones antes de iniciar la API. `launchSettings.json` no se utiliza al ejecutar una publicación; proporciona los puertos y certificados desde la configuración del host.

## Opción B: servidores separados

1. Publica `FrontEnd/dist` como archivos estáticos en un dominio HTTPS.
2. Antes de compilar, configura `VITE_API_BASE_URL=https://api.ejemplo.com/api`.
3. Publica la API en otro dominio HTTPS.
4. Configura en el backend `Cors__AllowedOrigins__0=https://app.ejemplo.com`.

El origen CORS debe incluir esquema, dominio y puerto cuando corresponda, sin una ruta ni barra final. En producción no se permiten orígenes externos de forma predeterminada. CORS controla al navegador; no reemplaza autenticación o autorización. La configuración sigue la [documentación oficial de CORS en ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/cors?view=aspnetcore-8.0).

`npm run preview` es para revisar un build local; no es el servidor de producción. El proxy configurado en Vite no se publica con `dist`. Si eliges una URL relativa `/api` en hosting estático, configura un proxy real del host hacia la API.

## HTTPS y cabeceras

El frontend y la API necesitan HTTPS en producción para evitar contenido mixto y habilitar el worker. El backend activa HSTS y redirección HTTPS en `Production`.

Si usas un proxy que termina HTTPS y reenvía por HTTP, configura en ASP.NET Core el procesamiento de `X-Forwarded-Proto` y los proxies de confianza antes de `UseHttpsRedirection`; de lo contrario puedes obtener redirecciones en bucle. La configuración depende de la plataforma y no se habilita indiscriminadamente en esta base. Sigue la [guía de proxy inverso de Microsoft](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-8.0).

Sirve `sw.js`, `index.html` y `manifest.webmanifest` con revalidación (`Cache-Control: no-cache`). El servidor estático de la API ya añade esta cabecera; si eliges otro host configura su equivalente. Los archivos con hash en `assets/` pueden conservar una caché larga.

El worker debe servirse desde `/sw.js` para controlar `/`. El manifest usa `id`, `scope` y `start_url` en `/`. Esta base asume un despliegue en la raíz del dominio. Para una subcarpeta hay que ajustar juntos `base` de Vite, URLs de iconos, alcance e inicio del manifest, registro del worker y rutas de la API.

## Datos y configuración

- Configura `ConnectionStrings__FarmBovi` con una ruta persistente; evita guardar datos dentro de un directorio que se reemplaza al desplegar.
- Asegura permisos de escritura y crea la carpeta antes de aplicar migraciones.
- SQLite requiere un sistema de archivos persistente. Un host efímero puede perder la base al reiniciar.
- Antes de cambios del esquema, realiza un respaldo consistente con las escrituras detenidas o con herramientas de backup de SQLite. Copiar únicamente `.db` mientras el proceso escribe puede omitir datos del WAL.
- Las variables `VITE_` quedan visibles en el build. Los secretos pertenecen a la configuración del backend y del host.
- Añade autenticación, autorización y permisos por rancho antes de usar esta API con datos reales en internet.

## GitHub

Repositorio público: [CJ-REYES/FarmBovi](https://github.com/CJ-REYES/FarmBovi).

Desde la raíz, el ciclo habitual de trabajo es:

```bash
git status
git add FrontEnd BackEnd docs scripts README.md
git commit -m "Describe el cambio realizado"
git push origin main
```

El `.gitignore` excluye `node_modules`, `dist`, `bin`, `obj`, bases de datos, artefactos, archivos locales `.env`, certificados y configuraciones de agentes. Se suben los ejemplos de entorno, migraciones y lockfiles. Ignorar un archivo no elimina versiones que ya fueron publicadas; si alguna vez expones un secreto, revócalo y revisa el historial.

GitHub Actions compila ambas aplicaciones con dependencias fijadas en cada push a `main` y pull request. Este workflow no despliega un sitio ni una API automáticamente.
