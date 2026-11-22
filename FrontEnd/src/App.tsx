import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { CattleProvider } from './context/CattleContext';
import { APP_ROUTES } from './routes';
import { SyncScheduler } from './services/sync/sync-scheduler';

const router = createBrowserRouter(APP_ROUTES);

export function App() {
  useEffect(() => {
    SyncScheduler.start();
    return () => {
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
