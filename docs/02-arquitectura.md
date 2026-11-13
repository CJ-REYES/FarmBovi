# Arquitectura

Hay dos aplicaciones independientes dentro de un mismo repositorio. React dibuja la interfaz y ASP.NET Core procesa los datos. MySQL pertenece al backend; el navegador nunca se conecta directamente a la base de datos.

```mermaid
flowchart LR
    Persona[Persona en el navegador o PWA] --> React[FrontEnd: React y Tailwind]
    React -->|HTTP JSON /api| API[BackEnd: Controllers]
    API --> EF[Data: EF Core]
    EF --> MySQL[(MySQL)]
    React -->|Última lectura correcta| Local[(localStorage del navegador)]
    Worker[Service worker] -->|Archivos para abrir sin conexión| React
```

## FrontEnd

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `src/main.tsx` | Monta React, estilos y fuentes locales |
| `src/App.tsx` | Pantalla del ganado, búsqueda y acciones |
| `src/components/CattleForm.tsx` | Formulario de alta y edición |
| `src/components/PwaStatus.tsx` | Instalación, disponibilidad sin conexión y actualización |
| `src/hooks/useCattle.ts` | Consulta la API, mantiene estados y recupera la copia local |
| `src/hooks/useInstallPrompt.ts` | Escucha los eventos de instalación del navegador |
| `src/lib/api.ts` | URL de la API, fetch, cancelación, timeout y errores |
| `src/lib/cattle-cache.ts` | Guarda y lee el listado con fecha y versión |
| `src/types/cattle.ts` | Contratos TypeScript del módulo |
| `src/index.css` | Tailwind v4, colores, fuentes y componentes visuales |
| `public/` | Iconos que Vite copia al build |
| `vite.config.ts` | Plugins, proxy local y generación PWA |

Tailwind v4 usa `@import 'tailwindcss'` y tokens `@theme` en CSS. No requiere un `tailwind.config.js` para esta configuración. Se integra mediante el plugin oficial [Tailwind para Vite](https://tailwindcss.com/docs/installation/using-vite).

Las fuentes se incluyen como dependencias `@fontsource` y se guardan en la precaché. No dependen de Google Fonts o de una conexión externa para dibujar la interfaz.

## BackEnd

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `Program.cs` | Registra dependencias y configura el pipeline HTTP |
| `Controllers/` | Recibe peticiones y devuelve respuestas HTTP |
| `DTOs/` | Define los datos de entrada y salida, con validación |
| `Models/` | Representa las entidades persistentes |
| `Data/FarmDbContext.cs` | Configura las cinco entidades, relaciones e índices únicos |
| `Data/DatabaseHealthCheck.cs` | Comprueba la conexión a MySQL |
| `Migrations/` | Guarda cambios del esquema para reconstruir la base |
| `Migrations/` | Cambios de esquema para MySQL |
| `Properties/launchSettings.json` | Puertos y entornos de los perfiles locales |

El `DbContext` se registra con duración *scoped*: cada petición recibe su instancia. Las consultas usan operaciones asíncronas y admiten cancelación. La lectura usa `AsNoTracking`, porque no va a modificar entidades cargadas.

El alcance inicial permite usar EF Core desde el controlador sin otra capa de repositorios. Cuando los módulos crezcan, mueve las reglas de negocio a servicios y conserva los controladores como entrada HTTP. No hace falta dividir cada carpeta en un proyecto separado para comenzar.

## Recorrido de un alta

La API expone CRUD para `Animal`, `Lote`, `Rancho`, `Usuario` y `UsuarioRancho`. Los índices únicos y las claves foráneas hacen cumplir las restricciones de datos en MySQL. Las contraseñas de usuario se almacenan con hash y se excluyen de las respuestas.

La pantalla actual del frontend todavía consume `/api/cattle`; el CRUD de modelos nuevo queda disponible en las rutas descritas en `docs/04-api-y-datos.md` y la interfaz requerirá adaptarse para consumir esas rutas.

Los errores no capturados usan `ProblemDetails`, un contrato de error HTTP; los detalles internos se registran en el servidor. Una respuesta de error de validación o autorización no se disfraza como una lectura sin conexión.

## Desarrollo y producción

En desarrollo, el navegador solicita `/api` a Vite y Vite lo reenvía a `localhost:5080`. Ambos servidores tienen que estar encendidos. Las peticiones directas a otro origen usan CORS; están permitidos los puertos locales previstos.

En producción puedes servir el frontend junto con la API o en un servidor distinto. El proxy de Vite existe únicamente en desarrollo y preview. El backend no permite orígenes externos por defecto en producción; configúralos si separas los dominios.

La instalación PWA cambia cómo se abre React, pero no convierte la API en un programa instalado en el teléfono. La base principal sigue en el servidor.
