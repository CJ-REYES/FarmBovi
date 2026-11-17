import { useSyncExternalStore } from 'react';
import {
  DeviceCapabilitiesService,
  type DeviceCapabilitiesSnapshot
} from '../services/device/device-capabilities.service';

export function useDeviceCapabilities(): DeviceCapabilitiesSnapshot & {
  promptInstall: () => ReturnType<typeof DeviceCapabilitiesService.triggerInstallPrompt>;
} {
  const snapshot = useSyncExternalStore(
    DeviceCapabilitiesService.subscribe,
    DeviceCapabilitiesService.getSnapshot,
    DeviceCapabilitiesService.getSnapshot
  );

  return {
    ...snapshot,
    promptInstall: () => DeviceCapabilitiesService.triggerInstallPrompt()
  };
}
