import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Bell,
  MapPin,
  Database,
  Wifi,
  WifiOff,
  RefreshCw,
  Menu,
  LogIn
} from 'lucide-react';
import { useSharedCattle } from '../../hooks/useCattle';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useAuth } from '../../hooks/useAuth';
import { resolveMediaUrl } from '../../lib/api';
import { getUserInitials } from '../../services/auth.service';

export interface TopbarProps {
  onMenuClick: () => void;
  onOpenSyncPanel?: () => void;
}

export default function Topbar({ onMenuClick, onOpenSyncPanel }: TopbarProps) {
  const navigate = useNavigate();
  const { cattle, ranches, error } = useSharedCattle();
  const {
    isOnline,
    isSyncing,
    counts,
    totalPendingWork,
    triggerManualSync
  } = useSyncStatus();
  const { session, isAuthenticated } = useAuth();
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const resolvedAvatarUrl = resolveMediaUrl(session?.fotoPerfilUrl);
  const showAvatarImage = Boolean(resolvedAvatarUrl && failedPhotoUrl !== resolvedAvatarUrl);

  const preferredRanch = session?.configuracion?.ranchoPredeterminadoId
    ? ranches.find((r) => r.id === session.configuracion?.ranchoPredeterminadoId)
    : undefined;
  const activeRanchName =
    preferredRanch?.nombre ||
    ranches[0]?.nombre ||
    session?.ranchos[0]?.nombre ||
    'Sin rancho asignado';
  const hasAttentionSync =
    counts.failedOperationsCount > 0 ||
    counts.failedFilesCount > 0 ||
    counts.pendingConflictsCount > 0;
  const pendingTotal =
    totalPendingWork + counts.failedOperationsCount + counts.pendingConflictsCount;

  const handleSyncButtonClick = async () => {
    if (!isOnline || hasAttentionSync) {
      if (onOpenSyncPanel) {
        onOpenSyncPanel();
        return;
      }
      navigate('/settings?tab=sincronizacion');
      return;
    }
    await triggerManualSync();
  };

  return (
    <header className="h-[64px] min-h-[64px] bg-surface-white border-b border-border-light px-4 md:px-6 flex items-center justify-between sticky top-0 z-20 gap-2">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger para móvil */}
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Abrir menú de navegación"
          className="lg:hidden p-2 -ml-2 text-brand-slate hover:bg-surface-secondary rounded-md"
        >
          <Menu size={22} />
        </button>

        {/* Contexto de Rancho */}
        <Link
          to="/ranches"
          title="Administrar o registrar ranchos"
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-surface-secondary hover:bg-brand-primary/10 rounded-md border border-border-light/50 transition-colors"
        >
          <MapPin size={16} className="text-brand-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-brand-slate/60 uppercase leading-none">
              Rancho Activo
            </p>
            <p className="text-[14px] font-semibold text-brand-slate leading-none mt-1 truncate max-w-[160px]">
              {activeRanchName}
            </p>
          </div>
        </Link>
      </div>

      {/* Búsqueda Universal */}
      <div className="hidden xl:flex flex-1 max-w-sm mx-4 relative">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40"
        />
        <input
          type="text"
          placeholder="Buscar por arete, RFID..."
          aria-label="Buscar bovinos"
          className="w-full h-[38px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 focus:outline-none focus:border-brand-primary"
        />
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {/* Indicador real de conectividad y datos locales (clic abre Centro de Sincronización) */}
        <div className="hidden lg:flex items-center gap-2 text-[12px] font-medium">
          <button
            type="button"
            onClick={() =>
              onOpenSyncPanel ? onOpenSyncPanel() : navigate('/settings?tab=sincronizacion')
            }
            className="cursor-pointer"
            title="Abrir Centro de Sincronización"
          >
            {!isOnline ? (
              <span
                role="status"
                className="flex items-center gap-1.5 text-amber-900 bg-status-warning/20 border border-status-warning/40 px-2.5 py-1 rounded-full font-semibold"
              >
                <WifiOff size={14} /> Sin conexión
                {counts.pendingOperationsCount > 0 && ` (${counts.pendingOperationsCount} pend.)`}
              </span>
            ) : isSyncing ? (
              <span
                role="status"
                className="flex items-center gap-1.5 text-brand-primary bg-brand-primary/10 px-2.5 py-1 rounded-full font-semibold"
              >
                <RefreshCw size={13} className="animate-spin" /> Sincronizando
              </span>
            ) : error ? (
              <span
                role="status"
                className="flex items-center gap-1.5 text-amber-800 bg-amber-500/15 px-2.5 py-1 rounded-full font-semibold"
                title={error}
              >
                <Database size={14} /> Caché local
              </span>
            ) : (
              <span
                role="status"
                className="flex items-center gap-1.5 text-status-success bg-status-success/10 px-2.5 py-1 rounded-full font-semibold"
              >
                <Wifi size={14} /> En línea
              </span>
            )}
          </button>

          <span
            className="hidden 2xl:inline-flex items-center gap-1 text-[11px] text-brand-slate/70 bg-surface-secondary/70 border border-border-light px-2 py-1 rounded-full"
            title="Registros disponibles localmente en este dispositivo para uso sin conexión"
          >
            <Database size={12} className="text-brand-primary" />
            {cattle.length} local
          </span>
        </div>

        {/* Botón siempre visible para Sincronizar datos */}
        <button
          type="button"
          onClick={() => void handleSyncButtonClick()}
          disabled={isSyncing}
          aria-label="Sincronizar datos"
          title={
            !isOnline
              ? 'Ver cola pendiente y estado offline'
              : hasAttentionSync
                ? 'Revisar errores o conflictos de sincronización'
                : 'Sincronizar cambios locales con el servidor (Push y Pull)'
          }
          className={`flex items-center gap-1.5 px-3 h-[38px] rounded-md font-semibold text-[12px] md:text-[13px] transition-colors border cursor-pointer disabled:opacity-60 ${
            hasAttentionSync
              ? 'bg-status-danger/10 border-status-danger/35 text-status-danger hover:bg-status-danger/15'
              : pendingTotal > 0
                ? 'bg-brand-yellow/20 border-brand-yellow/60 text-brand-dark hover:bg-brand-yellow/30'
                : 'bg-surface-white border-border-light text-brand-slate hover:border-brand-primary hover:text-brand-primary'
          }`}
        >
          <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">
            {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
          </span>
          {pendingTotal > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-forest text-white leading-none">
              {pendingTotal}
            </span>
          )}
        </button>

        {/* Nuevo Bovino */}
        <button
          type="button"
          onClick={() => navigate('/cattle/new')}
          className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-3 md:px-4 h-[38px] rounded-md font-semibold text-[13px] md:text-[14px] transition-colors shadow-sm cursor-pointer"
        >
          <Plus size={18} />
          <span className="hidden md:inline">Nuevo Bovino</span>
        </button>

        <div className="w-px h-6 bg-border-light hidden sm:block" />

        <button
          type="button"
          onClick={() => navigate('/alerts')}
          aria-label="Ir a alertas y recordatorios"
          className="relative text-brand-slate/70 hover:text-brand-primary transition-colors cursor-pointer"
        >
          <Bell size={20} />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-status-error border-2 border-white rounded-full" />
        </button>

        {isAuthenticated && session ? (
          <button
            type="button"
            onClick={() => navigate('/profile')}
            aria-label={`Perfil de ${session.nombre}`}
            title={`${session.nombre} (${session.correo})`}
            className="w-9 h-9 rounded-full bg-brand-forest text-white flex items-center justify-center font-bold text-[13px] uppercase overflow-hidden border border-border-light cursor-pointer"
          >
            {showAvatarImage && resolvedAvatarUrl ? (
              <img
                src={resolvedAvatarUrl}
                alt={`Foto de perfil de ${session.nombre}`}
                onError={() => setFailedPhotoUrl(resolvedAvatarUrl)}
                className="w-full h-full object-cover"
              />
            ) : (
              getUserInitials(session.nombre)
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/login')}
            aria-label="Iniciar sesión"
            title="Iniciar sesión para sincronizar con el Backend"
            className="inline-flex items-center gap-1.5 px-2.5 h-[34px] rounded-md bg-surface-secondary hover:bg-brand-primary hover:text-white text-brand-forest text-[12px] font-semibold transition-colors cursor-pointer"
          >
            <LogIn size={14} />
            <span className="hidden sm:inline">Entrar</span>
          </button>
        )}
      </div>
    </header>
  );
}
