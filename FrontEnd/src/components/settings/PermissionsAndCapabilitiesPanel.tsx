import { useEffect, useState } from 'react';
import {
  Camera,
  MapPin,
  Bell,
  HardDrive,
  Wifi,
  WifiOff,
  RefreshCw,
  Smartphone,
  Monitor,
  Tablet,
  Download,
  ShieldCheck,
  HelpCircle,
  AlertTriangle,
  Share
} from 'lucide-react';
import { useDeviceCapabilities } from '../../hooks/useDeviceCapabilities';
import { usePermissionsStatus } from '../../hooks/usePermissionsStatus';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { usePwaUpdate } from '../../hooks/usePwaUpdate';
import {
  PermissionsManagerService,
  type ManagedPermissionState
} from '../../services/permissions/permissions-manager.service';
import { formatStorageMb } from '../../services/storage-persistence.service';

function renderPermissionBadge(state: ManagedPermissionState) {
  switch (state) {
    case 'granted':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-status-success/15 text-status-success">
          <ShieldCheck size={12} /> Autorizado
        </span>
      );
    case 'denied':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-status-error/15 text-status-error">
          <AlertTriangle size={12} /> Rechazado
        </span>
      );
    case 'prompt':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-status-warning/15 text-amber-800">
          Sin autorización aún
        </span>
      );
    case 'unavailable':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-slate/15 text-brand-slate">
          No disponible
        </span>
      );
    case 'unknown':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-primary/10 text-brand-primary">
          <HelpCircle size={12} /> Estado desconocido
        </span>
      );
  }
}

export default function PermissionsAndCapabilitiesPanel() {
  const device = useDeviceCapabilities();
  const permissions = usePermissionsStatus();
  const syncStatus = useSyncStatus();
  const pwaUpdate = usePwaUpdate();

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [testingGeo, setTestingGeo] = useState(false);
  const [testingCam, setTestingCam] = useState(false);

  useEffect(() => {
    void permissions.refreshPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestCamera = async () => {
    setTestingCam(true);
    setActionMessage(null);
    try {
      const result = await PermissionsManagerService.requestCameraStream(true);
      if (result.stream) {
        for (const track of result.stream.getTracks()) {
          track.stop();
        }
        setActionMessage('Cámara verificada y autorizada correctamente.');
      } else if (result.userMessage) {
        setActionMessage(result.userMessage);
      }
    } finally {
      setTestingCam(false);
    }
  };

  const handleTestGeolocation = async () => {
    setTestingGeo(true);
    setActionMessage(null);
    try {
      const geo = await PermissionsManagerService.requestOneShotGeolocation();
      if (geo.ok) {
        setActionMessage(
          `Ubicación puntual obtenida (${geo.latitude?.toFixed(5)}, ${geo.longitude?.toFixed(5)}, precisión ±${geo.accuracyMeters} m).`
        );
      } else if (geo.userMessage) {
        setActionMessage(geo.userMessage);
      }
    } finally {
      setTestingGeo(false);
    }
  };

  const handleEnableNotifications = async () => {
    setActionMessage(null);
    const result = await permissions.requestNotifications();
    if (result === 'granted') {
      await PermissionsManagerService.sendPersistentNotification(
        'Notificaciones activadas en FarmBovi',
        'Recibirás avisos cuando se completen pesajes o existan conflictos pendientes.'
      );
      setActionMessage('Notificaciones persistentes habilitadas.');
    } else if (result === 'denied') {
      setActionMessage(
        'Notificaciones rechazadas. FarmBovi mantendrá los indicadores internos dentro de la aplicación.'
      );
    } else if (result === 'unavailable') {
      setActionMessage(
        'Este navegador no soporta notificaciones web (en iOS/iPadOS debes instalar la PWA en pantalla de inicio).'
      );
    }
  };

  const handleRequestPersistence = async () => {
    setActionMessage(null);
    const res = await permissions.requestStoragePersistence();
    setActionMessage(
      res.isPersisted
        ? 'Persistencia de almacenamiento concedida por el navegador.'
        : 'El navegador no concedió persistencia automática. Evita limpiar datos del sitio o llenar el almacenamiento del dispositivo.'
    );
  };

  const FormFactorIcon =
    device.formFactor === 'mobile'
      ? Smartphone
      : device.formFactor === 'tablet'
        ? Tablet
        : Monitor;

  return (
    <section
      aria-labelledby="permissions-panel-title"
      className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-light pb-3">
        <div>
          <h2
            id="permissions-panel-title"
            className="text-[16px] font-bold text-brand-slate"
          >
            Capacidades del Dispositivo y Permisos PWA
          </h2>
          <p className="text-[12px] text-brand-slate/70">
            Consulta el estado real de hardware, permisos y almacenamiento local. Ningún permiso se solicita sin tu acción explícita.
          </p>
        </div>

        {device.capabilities.installPromptAvailable && (
          <button
            type="button"
            onClick={() => void device.promptInstall()}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors"
          >
            <Download size={16} />
            Instalar FarmBovi
          </button>
        )}
      </div>

      {device.capabilities.iosInstallEligible && (
        <div className="p-3.5 rounded-lg bg-brand-primary/10 border border-brand-primary/25 text-[12px] text-brand-slate flex items-start gap-2.5">
          <Share size={16} className="text-brand-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Instalación en iPhone / iPad (Safari)</p>
            <p className="text-brand-slate/75 mt-0.5">
              Pulsa el botón <strong>Compartir</strong> en Safari y selecciona{' '}
              <strong>&ldquo;Agregar a inicio&rdquo;</strong> para abrir FarmBovi en modo independiente.
            </p>
          </div>
        </div>
      )}

      {actionMessage && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 rounded-lg bg-surface-secondary border border-border-light text-[12px] text-brand-slate"
        >
          {actionMessage}
        </div>
      )}

      {/* Tarjetas de estado del entorno y PWA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl border border-border-light bg-surface-secondary/40 space-y-1">
          <p className="text-[11px] font-bold uppercase text-brand-slate/60 flex items-center gap-1.5">
            <FormFactorIcon size={14} /> Presentación y Dispositivo
          </p>
          <p className="text-[14px] font-bold text-brand-slate">
            {device.presentationMode === 'standalone'
              ? 'Modo independiente (Standalone)'
              : 'Modo navegador web'}
          </p>
          <p className="text-[11px] text-brand-slate/70">
            Formato:{' '}
            {device.formFactor === 'mobile'
              ? 'Móvil'
              : device.formFactor === 'tablet'
                ? 'Tableta'
                : 'Escritorio'}{' '}
            • Entrada:{' '}
            {device.hasTouch && device.hasMouseOrTrackpad
              ? 'Táctil + Ratón/Teclado'
              : device.hasTouch
                ? 'Pantalla táctil'
                : 'Ratón y teclado'}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-border-light bg-surface-secondary/40 space-y-1">
          <p className="text-[11px] font-bold uppercase text-brand-slate/60 flex items-center gap-1.5">
            <RefreshCw size={14} /> Service Worker
          </p>
          <p className="text-[14px] font-bold text-brand-slate">
            {pwaUpdate.swState === 'registered' || pwaUpdate.swState === 'update_available'
              ? 'Registrado y activo'
              : pwaUpdate.swState === 'unsupported'
                ? 'No soportado'
                : 'Pendiente de registro'}
          </p>
          <p className="text-[11px] text-brand-slate/70">
            Versión: {pwaUpdate.swVersion ?? 'Sin confirmar'}
            {pwaUpdate.updateAvailable ? ' • Actualización lista' : ''}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-border-light bg-surface-secondary/40 space-y-1">
          <p className="text-[11px] font-bold uppercase text-brand-slate/60 flex items-center gap-1.5">
            {syncStatus.isOnline ? <Wifi size={14} /> : <WifiOff size={14} />} Conectividad
          </p>
          <p className="text-[14px] font-bold text-brand-slate">
            {syncStatus.isOnline ? 'Conectado al servidor' : 'Desconectado (Offline)'}
          </p>
          <p className="text-[11px] text-brand-slate/70">
            Estado de cola: {syncStatus.stateLabel}
          </p>
        </div>
      </div>

      {/* Lista de permisos y capacidades */}
      <div className="divide-y divide-border-light border border-border-light rounded-xl overflow-hidden">
        {/* 1. Cámara */}
        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Camera size={16} className="text-brand-primary" />
              <span className="font-bold text-[13px] text-brand-slate">
                Cámara fotográfica
              </span>
              {renderPermissionBadge(permissions.camera)}
            </div>
            <p className="text-[12px] text-brand-slate/70">
              Se utiliza únicamente al fotografiar bovinos o capturar evidencia de pesajes. Si se rechaza o no existe, puedes seleccionar archivos desde tu dispositivo.
            </p>
            {permissions.camera === 'unknown' && device.capabilities.cameraAvailable && (
              <p className="text-[11px] text-brand-slate/60">
                Este navegador no permite consultar el permiso sin abrir la cámara. Puedes verificarlo en los ajustes de privacidad del sitio en tu navegador.
              </p>
            )}
          </div>
          {device.capabilities.cameraAvailable && (
            <button
              type="button"
              disabled={testingCam}
              onClick={() => void handleTestCamera()}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-[12px] font-semibold text-brand-slate shrink-0"
            >
              {testingCam ? 'Comprobando...' : 'Solicitar / Comprobar cámara'}
            </button>
          )}
        </div>

        {/* 2. Ubicación */}
        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <MapPin size={16} className="text-brand-primary" />
              <span className="font-bold text-[13px] text-brand-slate">
                Geolocalización puntual
              </span>
              {renderPermissionBadge(permissions.geolocation)}
            </div>
            <p className="text-[12px] text-brand-slate/70">
              Se solicita de forma puntual solo si decides registrar las coordenadas del potrero o corral durante un evento. Nunca rastrea en segundo plano.
            </p>
          </div>
          {device.capabilities.geolocationAvailable && (
            <button
              type="button"
              disabled={testingGeo}
              onClick={() => void handleTestGeolocation()}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-[12px] font-semibold text-brand-slate shrink-0"
            >
              {testingGeo ? 'Obteniendo...' : 'Probar ubicación puntual'}
            </button>
          )}
        </div>

        {/* 3. Notificaciones */}
        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Bell size={16} className="text-brand-primary" />
              <span className="font-bold text-[13px] text-brand-slate">
                Notificaciones del sistema
              </span>
              {renderPermissionBadge(permissions.notifications)}
            </div>
            <p className="text-[12px] text-brand-slate/70">
              Te avisarán cuando finalice un análisis remoto de pesaje o exista un conflicto de sincronización. La sincronización funciona aunque las rechaces.
            </p>
          </div>
          {device.capabilities.notificationsAvailable &&
            permissions.notifications !== 'granted' &&
            permissions.notifications !== 'denied' && (
              <button
                type="button"
                onClick={() => void handleEnableNotifications()}
                className="min-h-[44px] px-3.5 py-2 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-[12px] font-semibold text-brand-slate shrink-0"
              >
                Activar notificaciones
              </button>
            )}
        </div>

        {/* 4. Almacenamiento local IndexedDB */}
        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <HardDrive size={16} className="text-brand-primary" />
              <span className="font-bold text-[13px] text-brand-slate">
                Almacenamiento local (IndexedDB)
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  permissions.storage.isPersisted
                    ? 'bg-status-success/15 text-status-success'
                    : 'bg-status-warning/15 text-amber-800'
                }`}
              >
                {permissions.storage.isPersisted
                  ? 'Persistencia concedida'
                  : 'Persistencia no concedida'}
              </span>
            </div>
            <p className="text-[12px] text-brand-slate/70">
              Uso estimado: {formatStorageMb(permissions.storage.usageBytes)} de{' '}
              {formatStorageMb(permissions.storage.quotaBytes)} (
              {permissions.storage.usagePercent}%).
            </p>
            <p className="text-[11px] text-brand-slate/60">
              Nota: Incluso con persistencia concedida, ningún navegador garantiza protección absoluta si borras manualmente los datos del sitio o el dispositivo se queda sin espacio.
            </p>
          </div>
          {device.capabilities.storagePersistAvailable && !permissions.storage.isPersisted && (
            <button
              type="button"
              onClick={() => void handleRequestPersistence()}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-[12px] font-semibold text-brand-slate shrink-0"
            >
              Solicitar persistencia
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
