# Solución de problemas

## El frontend abre, pero no carga el ganado

Abre `http://localhost:5080/health` y `http://localhost:5080/swagger`. Si no responden, inicia la API con `dotnet run --project BackEnd --launch-profile http` desde la raíz. Si cambiaste el puerto, ajusta `API_PROXY_TARGET` y reinicia Vite.

`VITE_API_BASE_URL` debe terminar en `/api`, sin añadir `/cattle`: el cliente agrega esa ruta. Una respuesta HTML en lugar de JSON suele indicar que `/api` apunta al servidor estático sin un proxy a la API.

## Error de CORS

Con `/api` y el proxy de Vite no debería aparecer un error CORS. Si conectas directamente con una URL distinta, añade el origen exacto de la interfaz a `Cors:AllowedOrigins` y reinicia la API. No uses `AllowAnyOrigin` como configuración general. Verifica también si usaste `localhost` o `127.0.0.1`, y si el frontend arrancó en otro puerto.

## Vite dice que el puerto está ocupado

Detén el proceso que usa `5173` o `4173`, o cambia de forma deliberada el puerto en `vite.config.ts`. Actualiza también la lista de orígenes si usas peticiones directas con CORS. El frontend no cambia de puerto automáticamente.

## No aparece «Instalar app»

Usa `npm run build` y `npm run preview`; `npm run dev` no genera el worker. Revisa el manifest y el worker en DevTools. Comprueba que la dirección sea localhost o HTTPS, que la app no esté ya instalada y que el navegador permita instalación. En iPhone usa el menú Compartir de Safari.

## La PWA abre sin conexión, pero no tiene datos

Necesitas una consulta correcta a la API antes de desconectarte. La app y los datos se guardan de forma independiente. No hay copia si se borró el almacenamiento, cambiaste de navegador, perfil u origen, o el navegador bloqueó `localStorage`. Abre la app en línea y actualiza.

## Se muestra una versión antigua

Termina el formulario y acepta **Actualizar app** cuando aparezca. El worker conserva el build activo hasta que aceptas el nuevo. Si estás diagnosticando en desarrollo, usa **Application → Service Workers → Unregister** y **Storage → Clear site data**, y vuelve a cargar en línea. No borres el almacenamiento de usuarios como solución habitual: también elimina su copia de datos.

Si no se detecta un nuevo build, verifica que el servidor revalide `sw.js` y que no esté servido desde una caché CDN obsoleta. Al probar builds consecutivos, deja al menos un minuto entre registros para evitar la heurística de actualizaciones de Workbox.

## Error por arete duplicado

El servidor responde `409` si el arete ya existe. Revisa el listado y usa **Editar** para cambiar los datos del animal existente, o asigna otro arete al nuevo animal. Se comparan los aretes normalizados a mayúsculas.

## Falló guardar después de una pérdida de red

No repitas la operación inmediatamente: el servidor pudo guardarla aunque la respuesta no llegó. Recupera la conexión y pulsa **Actualizar** para revisar el resultado. Los cambios del formulario no son un borrador persistente y se pierden al cerrar o recargar la página.

## No se encuentra un SDK .NET compatible

Instala un SDK de la rama 8, actualizado. `global.json` mantiene el SDK en .NET 8. Comprueba `dotnet --list-sdks`. Instalar solamente el runtime permite ejecutar una publicación, pero no compilar el código.

## NuGet o npm no descargan paquetes

Comprueba conexión y permisos del proxy empresarial. Repite `dotnet restore FarmBovi.sln` o `npm ci`; un timeout de descarga no implica un problema del código. Conserva los lockfiles. No desactives la verificación TLS para solucionar problemas de conexión.

## La base está bloqueada o no se puede escribir

Comprueba que el proceso tiene permisos en `App_Data` o en la carpeta configurada, que exista espacio en disco y que no haya otra herramienta manteniendo una transacción de escritura. Para una ruta personalizada crea antes su directorio. Ejecuta una sola instancia de la API con la base local del prototipo.

## Cambié el modelo, pero SQLite no tiene la columna

Genera una migración y aplícala siguiendo [API y datos](04-api-y-datos.md). No uses `EnsureCreated` para evitar las migraciones. En `Development` se aplican al arrancar; en `Production` hay que aplicarlas explícitamente.

## Las fechas se ven distintas

`birthDate` es una fecha sin zona horaria; el frontend la formatea al mediodía local para evitar desplazarla al día anterior. `createdAt` y la fecha de la copia se almacenan en UTC y se muestran según la zona del dispositivo. La validación de fecha futura usa la fecha UTC del servidor.

## No puedo subir cambios a GitHub

```bash
git remote -v
gh auth status
```

Si la sesión expiró, usa `gh auth login` y sigue el flujo de GitHub. No guardes tokens en archivos del repositorio. Verifica `git rev-parse --show-toplevel` antes de añadir archivos: debe señalar la carpeta de FarmBovi, no un directorio que contenga otros proyectos.
