import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { CattleProvider } from './context/CattleContext';
import { APP_ROUTES } from './routes';
import { AuthService } from './services/auth.service';
import { SyncScheduler } from './services/sync/sync-scheduler';

const router = createBrowserRouter(APP_ROUTES);

export function App() {
  useEffect(() => {
    let cancelled = false;
    const stopAuthListeners = AuthService.startLifecycleListeners();
    void AuthService.bootstrapSession().finally(() => {
      if (!cancelled) {
        SyncScheduler.start();
      }
    });
    return () => {
      cancelled = true;
      stopAuthListeners();
      SyncScheduler.stop();
    };
  }, []);
  return (
    <CattleProvider>
      <RouterProvider router={router} />
    </CattleProvider>
  );
}

export default App;
