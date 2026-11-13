# Estado de validación

Fecha: **8 de octubre de 2026**. Las comprobaciones se realizaron con Node 26.10.0, npm 12.2.0 y SDK .NET 8.0.131. El proyecto recomienda Node 24 LTS y el SDK .NET 8 actualizado; GitHub Actions compila con esas ramas.

## Comprobaciones locales realizadas

| Comprobación | Resultado |
| --- | --- |
| `npm run lint` | Sin errores |
| `npm run build` | TypeScript y Vite compilan; se generan manifest y worker |
| `dotnet restore FarmBovi.sln --locked-mode` | Restauración correcta con lockfile |
| `dotnet build FarmBovi.sln --configuration Release --no-restore` | Sin errores ni advertencias |
| Generación de la migración `InitialCreate` | Correcta; tabla e índice único versionados |
| Aplicación de migración al iniciar en Development | Correcta sobre una base temporal |
| `/health` | `200 Healthy` |
| Alta, lectura, edición y eliminación HTTP | `201`, `200`, `200` y `204` |
| Arete duplicado, incluida normalización a mayúsculas | `409` |
| Arete vacío, raza vacía y nacimiento futuro | `400` |
| Recurso o ruta inexistente | `404` |
| CORS | Origen local permitido; origen ajeno sin permiso |
| Proxy de Vite hacia la API | Correcto en preview |
| Publicación combinada | ASP.NET sirve React, API, worker y manifest |
| Cabeceras de archivos principales | `no-cache` en HTML, worker y manifest |
| Iconos PNG | Dimensiones 192×192 y 512×512 correctas |
| Navegador Chromium | Interfaz y formulario cargan; alta desde la pantalla correcta |
| Service worker | Activado en `http://localhost:4173/sw.js` |
| Recarga con red deshabilitada en el navegador | La app abre y muestra el último bovino guardado |
| Modificaciones durante la consulta sin conexión | Alta, edición y eliminación deshabilitadas |
| Recuperación de conexión | Vuelve a consultar el servidor |
| Vista móvil de 390×844 | Sin desbordamiento horizontal |

La API se inició con una conexión SQLite temporal bajo `/tmp`; los registros de comprobación no se incluyen en el repositorio ni en la base predeterminada. No se añadió una suite de pruebas unitarias; estas comprobaciones son de compilación y funcionamiento inicial.

## Comprobaciones manuales pendientes

- Instalación real y apertura standalone en Android y iPhone.
- Comportamiento con HTTPS y certificados del servidor que elijas.
- Aviso de nueva versión después de publicar otro build y aceptación de la actualización.
- Migraciones y persistencia sobre el almacenamiento de producción.
- Uso prolongado, varios dispositivos y volúmenes grandes de bovinos.

El workflow de GitHub comprueba las compilaciones después de cada push. La publicación inicial del código no crea un alojamiento HTTPS ni despliega la API.
