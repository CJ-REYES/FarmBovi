import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wifi,
  WifiOff,
  Download,
  RefreshCw,
  X,
  CheckCircle,
  AlertCircle,
  AlertOctagon,
  CloudUpload
} from 'lucide-react';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { usePwaUpdate } from '../../hooks/usePwaUpdate';
import { SystemNotificationsService } from '../../services/system-notifications.service';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const OFFLINE_TOAST_DURATION_MS = 5500;
const RECONNECTED_TOAST_DURATION_MS = 5500;

export default function PwaStatus() {
  const { isOnline, state, counts } = useSyncStatus();
  const { updateAvailable, swVersion, applyUpdate } = usePwaUpdate();

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
  );
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(true);
  const [offlineToast, setOfflineToast] = useState<{
    visible: boolean;
    justDisconnected: boolean;
  }>(() => ({ visible: !isOnline, justDisconnected: false }));
  const [reconnectedBanner, setReconnectedBanner] = useState<{
    visible: boolean;
    pendingAtReconnect: number;
  }>({ visible: false, pendingAtReconnect: 0 });

  const previousOnlineRef = useRef<boolean>(isOnline);
  const pendingCountRef = useRef<number>(counts.pendingOperationsCount);
  const pendingFilesRef = useRef<number>(counts.pendingFilesCount);

  useEffect(() => {
    pendingCountRef.current = counts.pendingOperationsCount;
    pendingFilesRef.current = counts.pendingFilesCount;
  }, [counts.pendingOperationsCount, counts.pendingFilesCount]);

  // Si se entra al proyecto sin conexión, mostrar notificación emergente unos segundos y registrarla en Alertas del Sistema
  useEffect(() => {
    if (isOnline) return undefined;

    SystemNotificationsService.recordEvent({
      codigo: 'offline-entry',
      titulo: 'Modo Offline Activo',
      descripcion:
        'Ingresaste sin conexión a Internet. Los cambios se guardan localmente en IndexedDB y se sincronizarán al reconectar.',
      categoria: 'offline',
      severidad: 'warning'
    });

    const hideTimer = window.setTimeout(() => {
      setOfflineToast((prev) => ({ ...prev, visible: false }));
    }, OFFLINE_TOAST_DURATION_MS);

    return () => {
      window.clearTimeout(hideTimer);
    };
    // Solo al entrar al proyecto (mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detectar transiciones reales de pérdida y recuperación de conexión
  useEffect(() => {
    const prevOnline = previousOnlineRef.current;
    previousOnlineRef.current = isOnline;

    if (prevOnline && !isOnline) {
      SystemNotificationsService.recordEvent({
        codigo: 'offline-lost',
        titulo: 'Conexión perdida · Modo Offline Activo',
        descripcion:
          'Se perdió la conexión a Internet. Tus cambios se seguirán guardando localmente en IndexedDB hasta reconectar.',
        categoria: 'offline',
        severidad: 'warning'
      });

      const showTimer = window.setTimeout(() => {
        setOfflineToast({ visible: true, justDisconnected: true });
        setReconnectedBanner({ visible: false, pendingAtReconnect: 0 });
      }, 0);

      const hideTimer = window.setTimeout(() => {
        setOfflineToast((prev) => ({ ...prev, visible: false }));
      }, OFFLINE_TOAST_DURATION_MS);

      return () => {
        window.clearTimeout(showTimer);
        window.clearTimeout(hideTimer);
      };
    }

    if (!prevOnline && isOnline) {
      const pendingNow = pendingCountRef.current;
      const pendingFilesNow = pendingFilesRef.current;

      SystemNotificationsService.recordEvent({
        codigo: 'online-restored',
        titulo: 'Conexión recuperada',
        descripcion:
          pendingNow > 0 || pendingFilesNow > 0
            ? `Conectado nuevamente. ${pendingNow} operación(es) y ${pendingFilesNow} fotografía(s) listas para sincronizar.`
            : 'Conectado nuevamente con el servidor.',
        categoria: 'offline',
        severidad: 'success'
      });

      const showTimer = window.setTimeout(() => {
        setOfflineToast({ visible: false, justDisconnected: false });
        setReconnectedBanner({ visible: true, pendingAtReconnect: pendingNow });
      }, 0);

      const hideTimer = window.setTimeout(() => {
        setReconnectedBanner((prev) => ({ ...prev, visible: false }));
      }, RECONNECTED_TOAST_DURATION_MS);

      return () => {
        window.clearTimeout(showTimer);
        window.clearTimeout(hideTimer);
      };
    }

    return undefined;
  }, [isOnline]);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setInstallPrompt(null);
    }
  };

  const handleUpdateApp = () => {
    applyUpdate(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none">
      {/* Notificación emergente temporal de Modo Offline (se oculta automáticamente y queda en Alertas del Sistema) */}
      {!isOnline && offlineToast.visible && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto bg-brand-dark text-white p-3.5 rounded-xl shadow-lg border border-border-dark/30 flex items-start justify-between gap-3 animate-in slide-in-from-bottom-4"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <WifiOff size={18} className="text-brand-yellow shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight">
                {offlineToast.justDisconnected
                  ? 'Conexión perdida · Modo Offline Activo'
                  : 'Modo Offline Activo'}
              </p>
              <p className="text-[11px] text-white/75 mt-0.5">
                Los cambios se guardan localmente en IndexedDB y se sincronizarán al reconectar.
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[10px] bg-brand-yellow/20 text-brand-yellow px-2 py-0.5 rounded font-bold uppercase">
                  {counts.pendingOperationsCount > 0 || counts.pendingFilesCount > 0
                    ? `${counts.pendingOperationsCount} op. • ${counts.pendingFilesCount} arch.`
                    : 'Caché'}
                </span>
                <Link
                  to="/alerts?seccion=sistema"
                  onClick={() => setOfflineToast((prev) => ({ ...prev, visible: false }))}
                  className="text-[11px] font-semibold text-brand-yellow hover:underline"
                >
                  Ver en Alertas del sistema
                </Link>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOfflineToast((prev) => ({ ...prev, visible: false }))}
            aria-label="Cerrar aviso de modo offline"
            className="p-1 hover:bg-white/15 rounded transition-colors shrink-0 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Aviso temporal de Reconexión Recuperada */}
      {isOnline && reconnectedBanner.visible && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto bg-status-success text-white p-3.5 rounded-xl shadow-lg flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4"
        >
          <div className="flex items-center gap-2.5">
            <Wifi size={18} className="shrink-0" />
            <div>
              <p className="text-[13px] font-bold leading-tight">Conexión recuperada</p>
              <p className="text-[11px] text-white/90 mt-0.5">
                {reconnectedBanner.pendingAtReconnect > 0
                  ? `${reconnectedBanner.pendingAtReconnect} operación(es) local(es) listas para sincronizar con el servidor.`
                  : 'Conectado nuevamente con el servidor.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReconnectedBanner({ visible: false, pendingAtReconnect: 0 })}
            aria-label="Cerrar aviso de reconexión"
            className="p-1 hover:bg-white/15 rounded transition-colors shrink-0 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Aviso de Conflictos Pendientes */}
      {isOnline && state === 'conflict' && (
        <div
          role="status"
          className="pointer-events-auto bg-purple-700 text-white p-3.5 rounded-xl shadow-lg flex items-center gap-2.5 animate-in slide-in-from-bottom-4"
        >
          <AlertOctagon size={18} className="shrink-0" />
          <p className="text-[12px] font-semibold">
            Tienes {counts.pendingConflictsCount} conflicto(s) de sincronización pendientes de
            revisar.
          </p>
        </div>
      )}

      {/* Aviso de Sincronización en Curso */}
      {isOnline && state === 'syncing' && (
        <div
          role="status"
          className="pointer-events-auto bg-brand-primary text-white p-3.5 rounded-xl shadow-lg flex items-center gap-2.5 animate-in slide-in-from-bottom-4"
        >
          <CloudUpload size={18} className="animate-pulse shrink-0" />
          <p className="text-[12px] font-semibold">
            Sincronizando {counts.pendingOperationsCount} operación(es) y {counts.pendingFilesCount}{' '}
            archivo(s)…
          </p>
        </div>
      )}

      {/* Banner de Actualización Pendiente del Service Worker (conectado a PwaUpdateManager) */}
      {updateAvailable && (
        <div
          role="status"
          className="pointer-events-auto bg-surface-white border border-brand-primary/40 text-brand-slate p-4 rounded-xl shadow-xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle size={18} className="text-brand-primary shrink-0" />
            <div>
              <p className="text-[13px] font-bold">Nueva versión disponible</p>
              <p className="text-[11px] text-brand-slate/65">
                Actualiza la aplicación para aplicar mejoras sin perder tus datos locales
                {swVersion ? ` (${swVersion})` : ''}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleUpdateApp}
            className="flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors shrink-0"
          >
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>
      )}

      {/* Promoción de Instalación PWA */}
      {installPrompt && !isInstalled && showInstallBanner && (
        <div className="pointer-events-auto bg-surface-white border border-border-light text-brand-slate p-4 rounded-xl shadow-xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0 font-bold font-condensed">
              FB
            </div>
            <div>
              <p className="text-[13px] font-bold">Instalar FarmBovi App</p>
              <p className="text-[11px] text-brand-slate/60">
                Accede rápidamente desde tu pantalla de inicio y trabaja sin conexión.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleInstallClick()}
              className="flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors"
            >
              <Download size={14} /> Instalar
            </button>
            <button
              type="button"
              onClick={() => setShowInstallBanner(false)}
              aria-label="Cerrar sugerencia de instalación"
              className="p-1 text-brand-slate/40 hover:text-brand-slate rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Confirmación Standalone */}
      {isInstalled && (
        <div className="hidden">
          <CheckCircle size={14} /> App Instalada
        </div>
      )}
    </div>
  );
}
