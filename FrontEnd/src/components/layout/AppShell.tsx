import { useState } from 'react';
import { X } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import PwaStatus from '../shared/PwaStatus';
import SyncStatusBadge from '../shared/SyncStatusBadge';
import SyncStatusPanel from '../shared/SyncStatusPanel';

export default function AppShell() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-surface-app overflow-hidden">
      {/* Overlay Móvil */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-brand-slate/40 z-30 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Modal del Centro de Sincronización */}
      {syncDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setSyncDrawerOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-xl bg-surface-white shadow-xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-surface-white border-b border-border-light">
              <span className="text-[13px] font-bold text-brand-slate">
                Estado de Sincronización Offline-First
              </span>
              <button
                type="button"
                onClick={() => setSyncDrawerOpen(false)}
                className="p-1.5 rounded-lg text-brand-slate/65 hover:text-brand-slate hover:bg-surface-secondary"
                aria-label="Cerrar panel de sincronización"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <SyncStatusPanel />
            </div>
          </div>
        </div>
      )}

      {/* Sidebar (fijo en desktop, off-canvas en móvil) */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onCloseMobile={() => setIsMobileMenuOpen(false)} />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <Topbar onMenuClick={() => setIsMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 scroll-smooth">
          <div className="mx-auto max-w-7xl animate-in fade-in duration-300">
            <div className="flex justify-end mb-4">
              <SyncStatusBadge onOpenPanel={() => setSyncDrawerOpen(true)} />
            </div>
            {/* React Router inyecta las pantallas aquí */}
            <Outlet />
          </div>
        </main>
        <PwaStatus />
      </div>
    </div>
  );
}
