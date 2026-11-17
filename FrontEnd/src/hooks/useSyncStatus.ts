import { useSyncExternalStore } from 'react';
import {
  SyncScheduler,
  type SyncSchedulerSnapshot
} from '../services/sync/sync-scheduler';

export function useSyncStatus(): SyncSchedulerSnapshot & {
  triggerManualSync: () => ReturnType<typeof SyncScheduler.triggerManualSync>;
  refreshStatus: () => ReturnType<typeof SyncScheduler.refreshState>;
} {
  const snapshot = useSyncExternalStore(
    SyncScheduler.subscribe,
    SyncScheduler.getSnapshot,
    SyncScheduler.getSnapshot
  );

  return {
    ...snapshot,
    triggerManualSync: () => SyncScheduler.triggerManualSync(),
    refreshStatus: () => SyncScheduler.refreshState()
  };
}
