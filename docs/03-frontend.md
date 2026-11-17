# 03. Frontend

## Stack declarado
React 19, TypeScript, Vite 8, Tailwind CSS 4 con `@tailwindcss/vite`, React Router 7, Lucide React y Dexie 4.

## Organización descrita

```text
FrontEnd/
├── public/
├── src/
│   ├── pwa/
│   ├── lib/database/
│   ├── services/
│   ├── hooks/
│   ├── components/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
└── vite.config.ts
```

La bitácora atribuye a `main.tsx` la inicialización de capacidades y registro del Service Worker, y a `App.tsx` el ciclo de vida del `SyncScheduler`.

## Rutas declaradas
`/dashboard`, `/cattle`, `/cattle/new`, `/cattle/:id`, `/cattle/:id/edit`, `/lots`, `/traceability`, `/feeding`, `/weighing`, `/health`, `/reproduction`, `/genealogy`, `/boviscale`, `/alerts`, `/reports`, `/settings`, `/profile`.

Confirma las rutas en `App.tsx`.

## Diseño adaptable
La bitácora menciona `MobileBottomNav` para móvil y `ResponsiveDataView` para adaptar tablas a tarjetas. Los tokens visuales declarados incluyen `#245C45`, `#193F30`, `#04442F`, `#203442`, `#E8B24D`, `#F6FAFF` y `#EBF5FF`; fuentes Source Sans 3 y Barlow Condensed.

## Verificación
Ejecuta los scripts disponibles en `package.json`. Lint, typecheck y build no sustituyen pruebas de flujos offline o multidispositivo.
