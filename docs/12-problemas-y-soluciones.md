# 12. Problemas y soluciones

Incidencias narradas en la bitácora; deben cotejarse con commits y diffs.

## Tailwind CSS 4
**Síntoma:** se perdió `@tailwindcss/vite` y `@theme`; CSS reportado bajó de 44.69 kB a 0.48 kB.  
**Corrección descrita:** restaurar `tailwindcss()` en Vite y `@import "tailwindcss"` más tokens en `src/index.css`.  
**Validación:** build y revisión del CSS generado.

## Tipos de Service Worker
**Síntoma:** conflicto entre tipos DOM y WebWorker.  
**Corrección descrita:** ajustar tipos sin alterar el literal `self.__WB_MANIFEST`.  
**Validación:** typecheck, build y revisión del SW generado.

## Manifiesto
**Síntoma:** `display_override` falló la validación mencionada.  
**Corrección descrita:** retirar la propiedad.  
**Validación:** comprobar manifiesto e instalación.

## Hooks React
**Síntoma:** retornos anticipados antes de `useEffect` en `PwaStatus`.  
**Corrección descrita:** mantener el mismo orden de hooks en cada render.  
**Validación:** ESLint y pruebas de estados.

## useState
**Síntoma:** desestructuración de cuatro valores desde `useState(false)`.  
**Corrección descrita:** usar `[estado, setter]`.  
**Validación:** typecheck y pruebas de paneles.

## Conectividad
**Síntoma:** frontend consultaba `/api/cattle`, mientras la ruta documentada era `/api/animales`.  
**Corrección descrita:** unificar ruta y rechazar fallback HTML y errores 502/503/504.  
**Validación:** API disponible/no disponible y respuestas de error.

## Panel de conflictos
**Síntoma:** datos no se actualizaban hasta el siguiente sondeo.  
**Corrección descrita:** separar `SyncConflictsPanel.tsx` y recargar estado al resolver.  
**Validación:** comprobar actualización inmediata.
