import { useSyncExternalStore } from 'react';
import {
  PermissionsManagerService,
  type PermissionsSnapshot
} from '../services/permissions/permissions-manager.service';

export function usePermissionsStatus(): PermissionsSnapshot & {
  refreshPermissions: () => Promise<PermissionsSnapshot>;
  requestNotifications: () => ReturnType<
    typeof PermissionsManagerService.requestNotificationPermission
  >;
  requestStoragePersistence: () => ReturnType<
    typeof PermissionsManagerService.requestPersistentStorage
  >;
} {
  const snapshot = useSyncExternalStore(
    PermissionsManagerService.subscribe,
    PermissionsManagerService.getSnapshot,
    PermissionsManagerService.getSnapshot
  );

  return {
    ...snapshot,
    refreshPermissions: () => PermissionsManagerService.refreshPassiveStates(),
    requestNotifications: () => PermissionsManagerService.requestNotificationPermission(),
    requestStoragePersistence: () => PermissionsManagerService.requestPersistentStorage()
  };
}
