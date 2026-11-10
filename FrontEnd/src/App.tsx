import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { CattleProvider } from './context/CattleContext';
import AppShell from './components/layout/AppShell';
import { DashboardPage } from './components/dashboard/DashboardPage';
import PlaceholderPage from './components/ui/PlaceholderPage';

// Importamos los nuevos componentes del módulo de bovinos
import CattleListPage from './components/cattle/CattleListPage';
import CattleForm from './components/cattle/CattleForm';
import CattleDetailPage from './components/cattle/CattleDetailPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },

      /* RUTAS FUNCIONALES DEL MÓDULO DE BOVINOS */
      { path: 'cattle', element: <CattleListPage /> },
      { path: 'cattle/new', element: <CattleForm /> },
      { path: 'cattle/:id/edit', element: <CattleForm /> },
      { path: 'cattle/:id', element: <CattleDetailPage /> },

      /* MÓDULOS PENDIENTES */
      { path: 'lots', element: <PlaceholderPage title="Gestión de Lotes y Potreros" module="Lotes" /> },
      { path: 'traceability', element: <PlaceholderPage title="Trazabilidad y Movimientos" module="Trazabilidad" /> },
      { path: 'feeding', element: <PlaceholderPage title="Alimentación y Raciones" module="Manejo" /> },
      { path: 'weighing', element: <PlaceholderPage title="Pesajes y Curvas de Crecimiento" module="Manejo" /> },
      { path: 'health', element: <PlaceholderPage title="Salud y Tratamientos" module="Manejo" /> },
      { path: 'reproduction', element: <PlaceholderPage title="Reproducción y Cría" module="Manejo" /> },
      { path: 'genealogy', element: <PlaceholderPage title="Genealogía y Parentesco" module="Manejo" /> },
      { path: 'boviscale', element: <PlaceholderPage title="Captura Fotográfica" module="Manejo" /> },
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
