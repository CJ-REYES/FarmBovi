import { useSyncExternalStore } from 'react';
import {
  PwaUpdateManager,
  type PwaUpdateSnapshot
} from '../pwa/update-manager';

export function usePwaUpdate(): PwaUpdateSnapshot & {
  checkForUpdates: () => Promise<void>;
  applyUpdate: (forceWithoutPrompt?: boolean) => boolean;
} {
  const snapshot = useSyncExternalStore(
    PwaUpdateManager.subscribe,
    PwaUpdateManager.getSnapshot,
    PwaUpdateManager.getSnapshot
  );

  return {
    ...snapshot,
    checkForUpdates: () => PwaUpdateManager.checkForUpdates(),
    applyUpdate: (forceWithoutPrompt = false) =>
      PwaUpdateManager.applyPendingUpdate(forceWithoutPrompt)
  };
}
