import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { CattleProvider } from './context/CattleContext';
import AppShell from './components/layout/AppShell';
import { DashboardPage } from './components/dashboard/DashboardPage';
import PlaceholderPage from './components/ui/PlaceholderPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />, // Layout persistente
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'cattle', element: <PlaceholderPage title="Directorio de Bovinos" module="Padrón Ganadero" /> },
      { path: 'cattle/new', element: <PlaceholderPage title="Registrar Nuevo Bovino" module="Padrón Ganadero" /> },
      { path: 'cattle/:id', element: <PlaceholderPage title="Expediente Clínico" module="Padrón Ganadero" /> },
      { path: 'lots', element: <PlaceholderPage title="Gestión de Lotes y Potreros" module="Lotes" /> },
      { path: 'traceability', element: <PlaceholderPage title="Trazabilidad y Movimientos" module="Trazabilidad" /> },
      { path: 'feeding', element: <PlaceholderPage title="Alimentación y Raciones" module="Manejo" /> },
      { path: 'weighing', element: <PlaceholderPage title="Pesajes y Curvas de Crecimiento" module="Manejo" /> },
      { path: 'health', element: <PlaceholderPage title="Salud y Tratamientos" module="Manejo" /> },
      { path: 'reproduction', element: <PlaceholderPage title="Reproducción y Cría" module="Manejo" /> },
      { path: 'genealogy', element: <PlaceholderPage title="Genealogía y Parentesco" module="Manejo" /> },
      { path: 'boviscale', element: <PlaceholderPage title="Captura Fotográfica (BoviScale Vision)" module="Manejo" /> },
      { path: 'alerts', element: <PlaceholderPage title="Alertas y Recordatorios" module="Seguimiento" /> },
      { path: 'reports', element: <PlaceholderPage title="Reportes" module="Seguimiento" /> },
      { path: 'settings', element: <PlaceholderPage title="Configuración del Rancho" module="Administración" /> },
      { path: 'profile', element: <PlaceholderPage title="Mi Perfil" module="Administración" /> },
      { path: '*', element: <PlaceholderPage title="Página no encontrada" module="Error 404" /> }
    ]
  }
]);

export function App() {
  return (
    <CattleProvider>
      <RouterProvider router={router} />
    </CattleProvider>
  );
}

export default App;
