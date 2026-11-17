export type DeviceFormFactor = 'mobile' | 'tablet' | 'desktop';
export type AppPresentationMode = 'browser' | 'standalone';
export type PrimaryPointerType = 'coarse' | 'fine' | 'none';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface DeviceCapabilitiesSnapshot {
  formFactor: DeviceFormFactor;
  presentationMode: AppPresentationMode;
  hasTouch: boolean;
  hasMouseOrTrackpad: boolean;
  primaryPointer: PrimaryPointerType;
  canHover: boolean;
  prefersReducedMotion: boolean;
  isIosFamily: boolean;
  capabilities: {
    cameraAvailable: boolean;
    fileInputAvailable: boolean;
    geolocationAvailable: boolean;
    notificationsAvailable: boolean;
    serviceWorkerAvailable: boolean;
    indexedDbAvailable: boolean;
    storagePersistAvailable: boolean;
    installPromptAvailable: boolean;
    iosInstallEligible: boolean;
  };
}

type CapabilitiesListener = () => void;

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<CapabilitiesListener>();
let initialized = false;
let detectedVideoInput: boolean | null = null;

function safeMatchMedia(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(query).matches;
}

function detectIosFamily(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || '';
  const maxTouch = navigator.maxTouchPoints || 0;
  // iPadOS moderno reporta platform 'MacIntel' con maxTouchPoints > 1
  if (platform === 'MacIntel' && maxTouch > 1) return true;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function detectPresentationMode(): AppPresentationMode {
  if (typeof window === 'undefined') return 'browser';

  const standaloneMedia =
    safeMatchMedia('(display-mode: standalone)') ||
    safeMatchMedia('(display-mode: fullscreen)') ||
    safeMatchMedia('(display-mode: minimal-ui)');

  const iosStandalone =
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  const androidTrustedWebActivity =
    typeof document !== 'undefined' &&
    document.referrer.startsWith('android-app://');

  return standaloneMedia || iosStandalone || androidTrustedWebActivity
    ? 'standalone'
    : 'browser';
}

function detectFormFactor(hasTouch: boolean, canHover: boolean): DeviceFormFactor {
  if (typeof window === 'undefined') return 'desktop';

  const width = window.innerWidth;
  const isSmallViewport = safeMatchMedia('(max-width: 767px)') || width < 768;
  const isMediumViewport =
    safeMatchMedia('(min-width: 768px) and (max-width: 1024px)') ||
    (width >= 768 && width <= 1024);

  if (isSmallViewport) {
    return 'mobile';
  }
  if (isMediumViewport && (hasTouch || !canHover)) {
    return 'tablet';
  }
  return 'desktop';
}

function computeSnapshot(): DeviceCapabilitiesSnapshot {
  const coarsePrimary = safeMatchMedia('(pointer: coarse)');
  const finePrimary = safeMatchMedia('(pointer: fine)');
  const anyCoarse = safeMatchMedia('(any-pointer: coarse)');
  const anyFine = safeMatchMedia('(any-pointer: fine)');
  const canHover = safeMatchMedia('(hover: hover)');
  const prefersReducedMotion = safeMatchMedia('(prefers-reduced-motion: reduce)');

  const hasTouch =
    anyCoarse ||
    coarsePrimary ||
    (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0);
  const hasMouseOrTrackpad = anyFine || finePrimary || canHover;

  const primaryPointer: PrimaryPointerType = coarsePrimary
    ? 'coarse'
    : finePrimary
      ? 'fine'
      : 'none';

  const formFactor = detectFormFactor(hasTouch, canHover);
  const presentationMode = detectPresentationMode();
  const isIosFamily = detectIosFamily();

  const hasMediaDevices =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

  const cameraAvailable =
    detectedVideoInput !== null ? detectedVideoInput : hasMediaDevices;

  const geolocationAvailable =
    typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const notificationsAvailable =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator;

  const serviceWorkerAvailable =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

  const indexedDbAvailable =
    typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null;

  const storagePersistAvailable =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.storage && typeof navigator.storage.persist === 'function');

  const installPromptAvailable =
    presentationMode === 'browser' && deferredInstallPrompt !== null;

  const iosInstallEligible =
    presentationMode === 'browser' && isIosFamily;

  return {
    formFactor,
    presentationMode,
    hasTouch,
    hasMouseOrTrackpad,
    primaryPointer,
    canHover,
    prefersReducedMotion,
    isIosFamily,
    capabilities: {
      cameraAvailable,
      fileInputAvailable: typeof document !== 'undefined',
      geolocationAvailable,
      notificationsAvailable,
      serviceWorkerAvailable,
      indexedDbAvailable,
      storagePersistAvailable,
      installPromptAvailable,
      iosInstallEligible
    }
  };
}

let currentSnapshot: DeviceCapabilitiesSnapshot = computeSnapshot();

function notifyIfChanged(): void {
  const next = computeSnapshot();
  if (JSON.stringify(next) !== JSON.stringify(currentSnapshot)) {
    currentSnapshot = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error en suscriptor de capacidades de dispositivo:', err);
      }
    }
  }
}

async function probeVideoHardwareWithoutPermission(): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== 'function'
  ) {
    detectedVideoInput = false;
    notifyIfChanged();
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    detectedVideoInput = devices.some((device) => device.kind === 'videoinput');
    notifyIfChanged();
  } catch {
    // Si el navegador restringe enumerateDevices antes del permiso, conservar detección por API
  }
}

export const DeviceCapabilitiesService = {
  initialize(): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredInstallPrompt = event as BeforeInstallPromptEvent;
      notifyIfChanged();
    };

    const handleAppInstalled = () => {
      deferredInstallPrompt = null;
      notifyIfChanged();
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('resize', notifyIfChanged);

    const mediaQueries = [
      '(max-width: 767px)',
      '(min-width: 768px) and (max-width: 1024px)',
      '(pointer: coarse)',
      '(pointer: fine)',
      '(hover: hover)',
      '(display-mode: standalone)',
      '(prefers-reduced-motion: reduce)'
    ];

    for (const query of mediaQueries) {
      if (typeof window.matchMedia === 'function') {
        window.matchMedia(query).addEventListener('change', notifyIfChanged);
      }
    }

    void probeVideoHardwareWithoutPermission();
    notifyIfChanged();
  },

  subscribe(listener: CapabilitiesListener): () => void {
    this.initialize();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): DeviceCapabilitiesSnapshot {
    return currentSnapshot;
  },

  async triggerInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferredInstallPrompt) return 'unavailable';
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredInstallPrompt = null;
      notifyIfChanged();
    }
    return outcome;
  }
};
