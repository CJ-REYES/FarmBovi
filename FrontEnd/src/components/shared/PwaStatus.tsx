import { useState, useEffect } from 'react';
import { WifiOff, Download, RefreshCw, X, CheckCircle, AlertCircle } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PwaStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Inicializamos el estado directamente para evitar renders en cascada y errores de ESLint
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
  );

  const [needRefresh, setNeedRefresh] = useState<boolean>(false);
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(true);

  useEffect(() => {
    // 1. Detección de Estado de Red
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 2. Captura de Evento de Instalación PWA
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // 3. Listener para Actualización de Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setNeedRefresh(true);
              }
            });
          }
        });
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
    // Previene recargas si hay inputs con datos no guardados
    const activeInputs = document.querySelectorAll('input:not([value=""]), textarea:not(:empty)');
    if (activeInputs.length > 0) {
      const confirmUpdate = window.confirm(
        'Hay datos ingresados en pantalla. ¿Deseas actualizar la aplicación y recargar la página ahora?'
      );
      if (!confirmUpdate) return;
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          window.location.reload();
        }
      });
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none">

      {/* Aviso de Modo Offline */}
      {!isOnline && (
        <div className="pointer-events-auto bg-brand-dark text-white p-3.5 rounded-xl shadow-lg border border-border-dark/30 flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2.5">
            <WifiOff size={18} className="text-brand-yellow shrink-0" />
            <div>
              <p className="text-[13px] font-bold leading-tight">Modo Offline Activo</p>
              <p className="text-[11px] text-white/70 mt-0.5">Acceso limitado al Padrón Ganadero almacenado en caché local.</p>
            </div>
          </div>
          <span className="text-[10px] bg-brand-yellow/20 text-brand-yellow px-2 py-0.5 rounded font-bold uppercase shrink-0">Caché</span>
        </div>
      )}

      {/* Banner de Actualización del Service Worker */}
      {needRefresh && (
        <div className="pointer-events-auto bg-surface-white border border-brand-primary/40 text-brand-slate p-4 rounded-xl shadow-xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={18} className="text-brand-primary shrink-0" />
            <div>
              <p className="text-[13px] font-bold">Nueva versión disponible</p>
              <p className="text-[11px] text-brand-slate/60">Actualiza la aplicación para cargar las últimas mejoras.</p>
            </div>
          </div>
          <button
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
              <p className="text-[11px] text-brand-slate/60">Accede rápidamente desde tu pantalla de inicio.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstallClick}
              className="flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors"
            >
              <Download size={14} /> Instalar
            </button>
            <button
              onClick={() => setShowInstallBanner(false)}
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
