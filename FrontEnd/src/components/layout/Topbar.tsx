import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Bell,
  MapPin,
  Database,
  Wifi,
  WifiOff,
  RefreshCw,
  Menu
} from 'lucide-react';
import { useSharedCattle } from '../../hooks/useCattle';
import { useSyncStatus } from '../../hooks/useSyncStatus';

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const navigate = useNavigate();
  const { cattle, ranches, error } = useSharedCattle();
  const { isOnline, isSyncing, counts } = useSyncStatus();

  const activeRanchName = ranches[0]?.nombre || 'Sin rancho asignado';

  return (
    <header className="h-[64px] min-h-[64px] bg-surface-white border-b border-border-light px-4 md:px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3">
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
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-surface-secondary rounded-md border border-border-light/50">
          <MapPin size={16} className="text-brand-primary shrink-0" />
          <div>
            <p className="text-[10px] font-bold text-brand-slate/60 uppercase leading-none">
              Rancho Activo
            </p>
            <p className="text-[14px] font-semibold text-brand-slate leading-none mt-1">
              {activeRanchName}
            </p>
          </div>
        </div>
      </div>

      {/* Búsqueda Universal */}
      <div className="hidden md:flex flex-1 max-w-md mx-4 lg:mx-8 relative">
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

      <div className="flex items-center gap-3 md:gap-4">
        {/* Indicador real de conectividad y datos locales */}
        <div className="hidden lg:flex items-center gap-2 text-[12px] font-medium">
          {!isOnline ? (
            <span
              role="status"
              className="flex items-center gap-1.5 text-amber-900 bg-status-warning/20 border border-status-warning/40 px-2.5 py-1 rounded-full font-semibold"
              title="Sin conexión a Internet. Los datos se guardan localmente en IndexedDB."
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

          <span
            className="hidden xl:inline-flex items-center gap-1 text-[11px] text-brand-slate/70 bg-surface-secondary/70 border border-border-light px-2 py-1 rounded-full"
            title="Registros disponibles localmente en este dispositivo para uso sin conexión"
          >
            <Database size={12} className="text-brand-primary" />
            {cattle.length} local
          </span>
        </div>

        {/* Acciones */}
        <button
          type="button"
          onClick={() => navigate('/cattle/new')}
          className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-3 md:px-4 h-[38px] rounded-md font-semibold text-[13px] md:text-[14px] transition-colors shadow-sm"
        >
          <Plus size={18} />
          <span className="hidden sm:inline">Nuevo Bovino</span>
        </button>

        <div className="w-px h-6 bg-border-light hidden sm:block"></div>

        <button
          type="button"
          onClick={() => navigate('/alerts')}
          aria-label="Ir a alertas y recordatorios"
          className="relative text-brand-slate/70 hover:text-brand-primary transition-colors"
        >
          <Bell size={20} />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-status-error border-2 border-white rounded-full"></span>
        </button>

        <button
          type="button"
          onClick={() => navigate('/profile')}
          aria-label="Perfil de usuario"
          className="w-8 h-8 rounded-full bg-brand-forest text-white flex items-center justify-center font-bold text-[14px] uppercase cursor-pointer"
        >
          CR
        </button>
      </div>
    </header>
  );
}
