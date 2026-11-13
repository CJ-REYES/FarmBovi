import { useNavigate } from 'react-router-dom';
import { Search, Plus, Bell, MapPin, Database, Wifi, Menu } from 'lucide-react';
import { useSharedCattle } from '../../context/CattleContext'; // Estado centralizado

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const navigate = useNavigate();
  // El error provendrá del contexto compartido, no dispara una petición nueva
  const { error } = useSharedCattle();

  return (
    <header className="h-[64px] min-h-[64px] bg-surface-white border-b border-border-light px-4 md:px-6 flex items-center justify-between sticky top-0 z-20">

      <div className="flex items-center gap-3">
        {/* Hamburger para móvil */}
        <button onClick={onMenuClick} className="lg:hidden p-2 -ml-2 text-brand-slate hover:bg-surface-secondary rounded-md">
          <Menu size={22} />
        </button>

        {/* Contexto de Rancho */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-surface-secondary rounded-md border border-border-light/50">
          <MapPin size={16} className="text-brand-primary" />
          <div>
            <p className="text-[10px] font-bold text-brand-slate/60 uppercase leading-none">Rancho Activo</p>
            <p className="text-[14px] font-semibold text-brand-slate leading-none mt-1">El Porvenir (Principal)</p>
          </div>
        </div>
      </div>

      {/* Búsqueda Universal */}
      <div className="hidden md:flex flex-1 max-w-md mx-4 lg:mx-8 relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" />
        <input
          type="text"
          placeholder="Buscar por arete, RFID..."
          className="w-full h-[38px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 focus:outline-none focus:border-brand-primary"
        />
      </div>

      <div className="flex items-center gap-3 md:gap-5">

        {/* Conectividad (Desde el Contexto) */}
        <div className="hidden lg:flex items-center gap-2 text-[12px] font-medium mr-2">
          {error ? (
             <span className="flex items-center gap-1.5 text-status-error bg-status-error/10 px-2 py-1 rounded-full"><Database size={14} /> Error API</span>
          ) : (
             <span className="flex items-center gap-1.5 text-status-success bg-status-success/10 px-2 py-1 rounded-full"><Wifi size={14} /> En línea</span>
          )}
        </div>

        {/* Acciones */}
        <button
          onClick={() => navigate('/cattle/new')}
          className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-3 md:px-4 h-[38px] rounded-md font-semibold text-[13px] md:text-[14px] transition-colors shadow-sm"
        >
          <Plus size={18} />
          <span className="hidden sm:inline">Nuevo Bovino</span>
        </button>

        <div className="w-px h-6 bg-border-light hidden sm:block"></div>

        <button onClick={() => navigate('/alerts')} className="relative text-brand-slate/70 hover:text-brand-primary transition-colors">
          <Bell size={20} />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-status-error border-2 border-white rounded-full"></span>
        </button>

        <button onClick={() => navigate('/profile')} className="w-8 h-8 rounded-full bg-brand-forest text-white flex items-center justify-center font-bold text-[14px] uppercase cursor-pointer">
          CR
        </button>
      </div>
    </header>
  );
}
