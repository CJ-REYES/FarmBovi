import { DeviceCapabilitiesService } from '../device/device-capabilities.service';
import {
  StoragePersistenceService,
  type StorageHealthSnapshot
} from '../storage-persistence.service';

export type ManagedPermissionState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unavailable'
  | 'unknown';

export interface GeolocationCaptureResult {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  timestamp?: string;
  errorReason?: 'unavailable' | 'denied' | 'position_unavailable' | 'timeout';
  userMessage?: string;
}

export interface PermissionsSnapshot {
  camera: ManagedPermissionState;
  geolocation: ManagedPermissionState;
  notifications: ManagedPermissionState;
  storage: StorageHealthSnapshot;
  lastCheckedAt: string | null;
}

type PermissionsListener = () => void;

const listeners = new Set<PermissionsListener>();

let currentPermissions: PermissionsSnapshot = {
  camera: 'unknown',
  geolocation: 'unknown',
  notifications: 'unknown',
  storage: StoragePersistenceService.getSnapshot(),
  lastCheckedAt: null
};

function emit(next: PermissionsSnapshot): void {
  currentPermissions = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error en suscriptor de permisos:', err);
    }
  }
}

async function queryBrowserPermission(
  name: PermissionName
): Promise<ManagedPermissionState> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.permissions ||
    typeof navigator.permissions.query !== 'function'
  ) {
    return 'unknown';
  }

  try {
    const status = await navigator.permissions.query({ name });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    // Safari / Firefox no soportan consultar 'camera' o 'notifications' en permissions.query
    return 'unknown';
  }
}

export const PermissionsManagerService = {
  subscribe(listener: PermissionsListener): () => void {
    listeners.add(listener);
    const unsubStorage = StoragePersistenceService.subscribe(() => {
      emit({
        ...currentPermissions,
        storage: StoragePersistenceService.getSnapshot()
      });
    });

    return () => {
      listeners.delete(listener);
      unsubStorage();
    };
  },

  getSnapshot(): PermissionsSnapshot {
    return currentPermissions;
  },

  /**
   * Consulta el estado pasivo de los permisos SIN disparar diálogos invasivos al usuario.
   */
  async refreshPassiveStates(): Promise<PermissionsSnapshot> {
    const device = DeviceCapabilitiesService.getSnapshot();

    const camera: ManagedPermissionState = !device.capabilities.cameraAvailable
      ? 'unavailable'
      : await queryBrowserPermission('camera' as PermissionName);

    const geolocation: ManagedPermissionState = !device.capabilities.geolocationAvailable
      ? 'unavailable'
      : await queryBrowserPermission('geolocation');

    let notifications: ManagedPermissionState = 'unavailable';
    if (device.capabilities.notificationsAvailable && typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        notifications = 'granted';
      } else if (Notification.permission === 'denied') {
        notifications = 'denied';
      } else {
        notifications = 'prompt';
      }
    }

    const storage = await StoragePersistenceService.checkQuota();

    const next: PermissionsSnapshot = {
      camera,
      geolocation,
      notifications,
      storage,
      lastCheckedAt: new Date().toISOString()
    };

    emit(next);
    return next;
  },

  /**
   * Solicita acceso a la cámara únicamente cuando el usuario abre captura fotográfica.
   * Devuelve el MediaStream activo si tuvo éxito, o explica el fallo para usar selector de archivos.
   */
  async requestCameraStream(preferRearCamera = true): Promise<{
    stream: MediaStream | null;
    state: ManagedPermissionState;
    userMessage?: string;
  }> {
    const device = DeviceCapabilitiesService.getSnapshot();
    if (!device.capabilities.cameraAvailable || !navigator.mediaDevices?.getUserMedia) {
      await this.refreshPassiveStates();
      return {
        stream: null,
        state: 'unavailable',
        userMessage:
          'Este dispositivo o navegador no expone una cámara compatible. Utiliza la opción de seleccionar fotografía desde tus archivos.'
      };
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: preferRearCamera
          ? { facingMode: { ideal: 'environment' } }
          : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      emit({
        ...currentPermissions,
        camera: 'granted',
        lastCheckedAt: new Date().toISOString()
      });
      return { stream, state: 'granted' };
    } catch (err) {
      const errorName = err instanceof DOMException ? err.name : '';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        emit({
          ...currentPermissions,
          camera: 'denied',
          lastCheckedAt: new Date().toISOString()
        });
        return {
          stream: null,
          state: 'denied',
          userMessage:
            'Permiso de cámara rechazado. Puedes habilitarlo en la configuración del navegador o adjuntar una fotografía desde el selector de archivos.'
        };
      }

      if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        emit({
          ...currentPermissions,
          camera: 'unavailable',
          lastCheckedAt: new Date().toISOString()
        });
        return {
          stream: null,
          state: 'unavailable',
          userMessage:
            'No se detectó ninguna cámara física conectada. Usa el selector de archivos para adjuntar evidencia.'
        };
      }

      return {
        stream: null,
        state: 'unknown',
        userMessage:
          'No fue posible iniciar la cámara en este momento (puede estar ocupada por otra aplicación). Puedes seleccionar una foto desde archivos.'
      };
    }
  },

  /**
   * Solicita una lectura puntual de ubicación cuando el usuario la invoca explícitamente.
   */
  async requestOneShotGeolocation(): Promise<GeolocationCaptureResult> {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return {
        ok: false,
        errorReason: 'unavailable',
        userMessage: 'La geolocalización no está disponible en este dispositivo.'
      };
    }

    return await new Promise<GeolocationCaptureResult>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          emit({
            ...currentPermissions,
            geolocation: 'granted',
            lastCheckedAt: new Date().toISOString()
          });
          resolve({
            ok: true,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: Math.round(pos.coords.accuracy),
            timestamp: new Date(pos.timestamp).toISOString()
          });
        },
        (geoErr) => {
          if (geoErr.code === geoErr.PERMISSION_DENIED) {
            emit({
              ...currentPermissions,
              geolocation: 'denied',
              lastCheckedAt: new Date().toISOString()
            });
            resolve({
              ok: false,
              errorReason: 'denied',
              userMessage:
                'Permiso de ubicación rechazado. El registro puede guardarse sin coordenadas.'
            });
            return;
          }

          if (geoErr.code === geoErr.TIMEOUT) {
            resolve({
              ok: false,
              errorReason: 'timeout',
              userMessage:
                'Tiempo de espera agotado al obtener señal GPS. Puedes guardar el registro sin ubicación.'
            });
            return;
          }

          resolve({
            ok: false,
            errorReason: 'position_unavailable',
            userMessage:
              'Ubicación desactivada o sin señal GPS disponible en este momento.'
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    });
  },

  /**
   * Solicita permiso de notificaciones tras acción explícita del usuario y envía
   * notificaciones persistentes mediante el Service Worker cuando está activo.
   */
  async requestNotificationPermission(): Promise<ManagedPermissionState> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unavailable';
    }

    try {
      const result = await Notification.requestPermission();
      const mapped: ManagedPermissionState =
        result === 'granted'
          ? 'granted'
          : result === 'denied'
            ? 'denied'
            : 'prompt';

      emit({
        ...currentPermissions,
        notifications: mapped,
        lastCheckedAt: new Date().toISOString()
      });
      return mapped;
    } catch {
      return 'unknown';
    }
  },

  async sendPersistentNotification(
    title: string,
    body: string,
    url = '/'
  ): Promise<boolean> {
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted' ||
      !('serviceWorker' in navigator)
    ) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        tag: 'farmbovi-status',
        data: { url }
      });
      return true;
    } catch {
      return false;
    }
  },

  async requestPersistentStorage(): Promise<StorageHealthSnapshot> {
    const result = await StoragePersistenceService.initializeAndRequestPersistence();
    emit({
      ...currentPermissions,
      storage: result,
      lastCheckedAt: new Date().toISOString()
    });
    return result;
  }
};
