# Tu primera PWA

Una **Progressive Web App** es una aplicación web que el navegador puede instalar y abrir como una app. Se desarrolla con las mismas herramientas del frontend. Un manifest describe la instalación; un service worker permite servir archivos guardados cuando la red no está disponible.

Esta integración sigue las guías oficiales de [Vite PWA para React](https://vite-pwa-org.netlify.app/frameworks/react) y los [requisitos de instalación de MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Qué incluye FarmBovi

| Pieza | Dónde se configura | Para qué sirve |
| --- | --- | --- |
| Manifest | `FrontEnd/vite.config.ts` | Nombre, idioma, colores, URL inicial y apertura standalone |
| Iconos PNG | `FrontEnd/public/icons` | Iconos 192 y 512, además de una versión maskable |
| Icono Apple | `FrontEnd/public/apple-touch-icon.png` | Icono para la pantalla de inicio de iOS |
| Service worker | Generado como `FrontEnd/dist/sw.js` | Precaché de HTML, JavaScript, CSS, fuentes e iconos |
| Registro del worker | `PwaStatus.tsx`, con `useRegisterSW` | Activa el worker y muestra sus avisos |
| Instalación | `useInstallPrompt.ts` | Ofrece el diálogo nativo cuando está disponible |
| Copia del ganado | `cattle-cache.ts` | Permite consultar el último listado correcto |

No edites `dist/sw.js` o `dist/manifest.webmanifest` directamente. Se regeneran en cada build y `dist` está ignorado por Git. Para cambiar el nombre, color o iconos, modifica la configuración fuente y vuelve a compilar.

El icono maskable sitúa el dibujo dentro de una zona segura para que Android pueda recortarlo. Los PNG están versionados; para regenerarlos existe `scripts/generate-icons.py`, que requiere Python y Pillow solo cuando quieras editar el diseño.

## Dos tipos de almacenamiento

**Archivos de la app:** Workbox guarda los archivos del build en Cache Storage. Así puede abrirse la pantalla sin pedir otra vez el HTML, los estilos y el código al servidor.

**Datos del ganado:** React guarda una copia de la última lectura en `localStorage`, junto con `savedAt`. La clave empieza por `farmbovi:cattle:v1:` y contiene la URL base de la API para separar servidores. Esta copia no es la base SQLite y puede estar desactualizada.

El service worker no guarda respuestas de `/api`, `/health` ni Swagger. La API se solicita por red y la aplicación decide explícitamente cuándo mostrar una copia. Si la red falla o el servidor devuelve un error 5xx, se puede recuperar esa copia; errores 4xx no activan esa recuperación.

La copia incluye todo el listado del prototipo. Para grandes hatos, incorpora paginación e IndexedDB. Al añadir usuarios, la clave y el borrado del almacenamiento deben separarse también por usuario y rancho.

## Comportamiento sin conexión

1. Abre el build al menos una vez con conexión.
2. Espera a que se complete la instalación del worker y aparezca el aviso de que la app puede abrirse sin conexión.
3. Consulta la API correctamente: esto guarda el listado y su fecha.
4. Al perder conexión, FarmBovi muestra la copia con un aviso y deshabilita alta, edición y eliminación.
5. Cuando el navegador detecta que vuelve la red, se consulta la API otra vez. También puedes pulsar **Actualizar**.

El indicador «Servidor disponible» significa que la última petición respondió; no es una garantía de que la siguiente vaya a responder. El cliente trata también los errores de cada operación.

Si nunca consultaste el ganado, no hay datos para mostrar sin conexión. Si nunca abriste el build, no están descargados los archivos necesarios. Si el navegador bloquea o llena `localStorage`, la consulta en línea funciona y aparece un aviso de que no se pudo guardar una copia.

**No hay cola de escrituras.** Un formulario abierto conserva sus datos mientras la página sigue abierta, pero no los guarda como borrador persistente. Si una petición de escritura pierde la respuesta, el servidor pudo haberla aplicado; recupera la conexión y actualiza el listado antes de repetirla. No hay reintentos automáticos de POST, PUT o DELETE.

## Probarla localmente

Deja la API encendida. En `FrontEnd`:

```bash
npm run build
npm run preview
```

Abre `http://localhost:4173`. En DevTools de Chrome o Edge:

1. Ve a **Application → Manifest** y revisa nombre e iconos.
2. Ve a **Application → Service Workers** y comprueba que `/sw.js` está activado.
3. Consulta el listado. Puedes crear un bovino para comprobar que la copia contiene datos reales.
4. Recarga una vez para que la página esté controlada por el worker.
5. Activa **Network → Offline** y recarga. La app debe abrirse y mostrar la copia con fecha.
6. Comprueba que las modificaciones están deshabilitadas.
7. Desactiva **Offline** y pulsa **Actualizar**.

`npm run dev` no registra el worker. Usa `preview` para esta prueba y mantén el mismo navegador y origen: `localhost:5173` y `localhost:4173` tienen almacenamientos independientes.

## Instalar en un dispositivo

- **Chrome o Edge de escritorio:** usa el botón «Instalar app» si aparece, el icono de instalación o el menú del navegador.
- **Android:** abre una dirección HTTPS en un navegador compatible y usa la opción de instalación disponible.
- **iPhone o iPad:** abre la dirección HTTPS en Safari, luego **Compartir → Añadir a pantalla de inicio**. Safari no proporciona el mismo evento `beforeinstallprompt`; por eso FarmBovi muestra instrucciones cuando no hay diálogo programático.

La disponibilidad y el texto del menú dependen del navegador. Que el botón de FarmBovi no aparezca no implica que la web esté dañada: puede estar instalada, no haber cumplido los criterios del navegador o requerir instalación desde el menú.

## HTTPS y localhost

Los service workers necesitan un contexto seguro. `http://localhost` es una excepción útil para desarrollo. En cambio, abrir `http://192.168.x.x:4173` desde un teléfono no es localhost para ese teléfono y normalmente no habilita el worker.

Para probar en un teléfono usa una publicación HTTPS o un túnel HTTPS hacia `4173`. Si conservas `VITE_API_BASE_URL=/api`, el proxy de preview conecta con tu API local. Para que un túnel alcance Vite puede hacer falta `npm run preview -- --host 0.0.0.0` y permitir explícitamente su dominio en `preview.allowedHosts`; evita permitir todos los dominios.

## Actualizaciones

FarmBovi usa `registerType: 'prompt'`. Cuando el navegador detecta otro build, descarga los nuevos archivos y muestra **Actualizar app**. El usuario decide cuándo recargar. Se deshabilita esa acción mientras hay un formulario abierto para evitar perder sus datos.

Este comportamiento sigue la [guía de avisos de actualización de Vite PWA](https://vite-pwa-org.netlify.app/guide/prompt-for-update). El navegador busca cambios al registrar el worker en una visita; esta base no consulta versiones de forma periódica. Para detectar una actualización en una sesión prolongada, cierra y vuelve a abrir la app o recarga cuando hayas terminado el formulario.

Los cachés de archivos obsoletos se limpian durante la activación de un nuevo worker. La copia de ganado en `localStorage` tiene su propio ciclo: se reemplaza después de lecturas correctas y se actualiza tras las modificaciones confirmadas. No se elimina solo porque cambió el build.

## Borrar los datos locales

En DevTools, **Application → Storage → Clear site data** elimina cachés y almacenamiento del origen. También puedes quitar el registro del worker en **Service Workers → Unregister**. Esto borra la copia del dispositivo y obliga a cargar otra vez con internet; no elimina los bovinos del servidor.

Desinstalar una PWA no garantiza que todos los navegadores borren el almacenamiento del sitio. En dispositivos compartidos borra también sus datos de navegación. Antes de añadir información privada y sesiones, implementa un borrado explícito al cerrar sesión.

## Siguientes pasos

Para capturar movimientos sin conexión hace falta un diseño adicional: IndexedDB, identificadores locales, cola de operaciones, autenticación, reintentos, deduplicación y resolución de conflictos entre dispositivos. El service worker por sí solo no resuelve esos problemas.
