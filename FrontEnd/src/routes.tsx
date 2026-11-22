import type { RouteObject } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LandingPage from './components/public/LandingPage';
import AuthPage from './components/auth/AuthPage';
import { ProtectedRoute, PublicOnlyRoute } from './components/auth/RouteGuards';
import { DashboardPage } from './components/dashboard/DashboardPage';

// Módulo Bovinos
import CattleListPage from './components/cattle/CattleListPage';
import CattleForm from './components/cattle/CattleForm';
import CattleDetailPage from './components/cattle/CattleDetailPage';

// Módulos de Manejo Ganadero
import LotsPage from './components/management/LotsPage';
import TraceabilityPage from './components/management/TraceabilityPage';
import FeedingPage from './components/management/FeedingPage';
import WeighingPage from './components/management/WeighingPage';
import HealthPage from './components/management/HealthPage';
import ReproductionPage from './components/management/ReproductionPage';
import GenealogyPage from './components/management/GenealogyPage';
import PlaceholderPage from './components/ui/PlaceholderPage';

import BoviScalePage from './components/management/BoviScalePage';
import AlertsPage from './components/management/AlertsPage';
import ReportsPage from './components/management/ReportsPage';
import SettingsPage from './components/management/SettingsPage';
import ProfilePage from './components/management/ProfilePage';

export const APP_ROUTES: RouteObject[] = [
  // Ruta pública informativa
  { path: '/', element: <LandingPage /> },

  // Rutas solo para visitantes sin sesión activa
  {
    element: <PublicOnlyRoute />,
    children: [
      { path: '/login', element: <AuthPage key="login" initialMode="login" /> },
      { path: '/register', element: <AuthPage key="register" initialMode="register" /> }
    ]
  },

  // Ruta privada de onboarding: exige sesión JWT pero permite completar registro de rancho
  {
    element: <ProtectedRoute requireRanch={false} />,
    children: [{ path: '/ranch-setup', element: <AuthPage key="ranch" initialMode="ranch" /> }]
  },

  // Rutas privadas de operación: exigen sesión JWT válida y al menos un rancho activo
  {
    element: <ProtectedRoute requireRanch />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
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
          { path: 'boviscale', element: <BoviScalePage /> },
          { path: 'alerts', element: <AlertsPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'profile', element: <ProfilePage /> },

          /* FUTUROS MÓDULOS */
          {
            path: '*',
            element: <PlaceholderPage title="Página no encontrada" module="Error 404" />
          }
        ]
      }
    ]
  }
];
