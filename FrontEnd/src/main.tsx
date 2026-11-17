import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { registerFarmBoviServiceWorker } from './pwa/registerSW';
import { DeviceCapabilitiesService } from './services/device/device-capabilities.service';

DeviceCapabilitiesService.initialize();
registerFarmBoviServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
