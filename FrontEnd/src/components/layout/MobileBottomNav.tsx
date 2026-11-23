import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Beef, Scale, RefreshCw, Settings } from 'lucide-react';
import { useSyncStatus } from '../../hooks/useSyncStatus';

export interface MobileBottomNavProps {
  onOpenSyncDrawer: () => void;
  onOpenPermissionsModal: () => void;
}

export default function MobileBottomNav({
  onOpenSyncDrawer,
  onOpenPermissionsModal
}: MobileBottomNavProps) {
  const { totalPendingWork, counts } = useSyncStatus();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `min-h-[48px] flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand-primary ${
      isActive
        ? 'text-brand-primary'
        : 'text-brand-slate/70 hover:text-brand-slate'
    }`;

  return (
    <nav
      aria-label="Navegación principal móvil"
      className="lg:hidden sticky bottom-0 z-30 bg-surface-white/95 backdrop-blur border-t border-border-light px-1 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center justify-around">
        <NavLink to="/dashboard" end className={linkClass}>
          <LayoutDashboard size={18} />
          <span>Inicio</span>
        </NavLink>

        <NavLink to="/cattle" className={linkClass}>
          <Beef size={18} />
          <span>Hato</span>
        </NavLink>

        <NavLink to="/weighing" className={linkClass}>
          <Scale size={18} />
          <span>Pesajes</span>
        </NavLink>

        <button
          type="button"
          onClick={onOpenSyncDrawer}
          className="relative min-h-[48px] flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-brand-slate/70 hover:text-brand-slate focus-visible:outline-2 focus-visible:outline-brand-primary"
          aria-label="Abrir estado de sincronización"
        >
          <RefreshCw size={18} />
          <span>Sincronizar</span>
          {(totalPendingWork > 0 || counts.pendingConflictsCount > 0) && (
            <span className="absolute top-1.5 right-3 min-w-[16px] h-4 px-1 rounded-full bg-brand-primary text-white text-[10px] font-bold flex items-center justify-center">
              {totalPendingWork + counts.pendingConflictsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenPermissionsModal}
          className="min-h-[48px] flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-brand-slate/70 hover:text-brand-slate focus-visible:outline-2 focus-visible:outline-brand-primary"
          aria-label="Abrir permisos y capacidades del dispositivo"
        >
          <Settings size={18} />
          <span>Permisos</span>
        </button>
      </div>
    </nav>
  );
}
