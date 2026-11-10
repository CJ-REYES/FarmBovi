import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { CattleProvider } from './context/CattleContext';
import AppShell from './components/layout/AppShell';
import { DashboardPage } from './components/dashboard/DashboardPage';

// Módulo Bovinos
import CattleListPage from './components/cattle/CattleListPage';
import CattleForm from './components/cattle/CattleForm';
import CattleDetailPage from './components/cattle/CattleDetailPage';

// Nuevos Módulos de Manejo Ganadero
import LotsPage from './components/management/LotsPage';
import TraceabilityPage from './components/management/TraceabilityPage';
import FeedingPage from './components/management/FeedingPage';
import WeighingPage from './components/management/WeighingPage';
import HealthPage from './components/management/HealthPage';
import ReproductionPage from './components/management/ReproductionPage';
import GenealogyPage from './components/management/GenealogyPage';
import PlaceholderPage from './components/ui/PlaceholderPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },

      { path: 'cattle', element: <CattleListPage /> },
      { path: 'cattle/new', element: <CattleForm /> },
      { path: 'cattle/:id/edit', element: <CattleForm /> },
      { path: 'cattle/:id', element: <CattleDetailPage /> },

      /* MÓDULOS FASE 4: MANEJO GANADERO */
      { path: 'lots', element: <LotsPage /> },
      { path: 'traceability', element: <TraceabilityPage /> },
      { path: 'feeding', element: <FeedingPage /> },
      { path: 'weighing', element: <WeighingPage /> },
      { path: 'health', element: <HealthPage /> },
      { path: 'reproduction', element: <ReproductionPage /> },
      { path: 'genealogy', element: <GenealogyPage /> },

      /* FUTUROS MÓDULOS */
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
