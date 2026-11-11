import { Search, Plus, Bell, MapPin, Database, Wifi, Syringe, Beef, LayoutDashboard } from 'lucide-react'
import { useCattle } from '../../hooks/useCattle'
import type { NavSection } from './Sidebar'

interface TopbarProps {
  activeSection?: NavSection
  onSelectSection?: (section: NavSection) => void
}

export default function Topbar({ activeSection, onSelectSection }: TopbarProps) {
  const { error } = useCattle()

  return (
    <header className="h-[64px] min-h-[64px] bg-surface-white border-b border-border-light px-4 md:px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary rounded-md border border-border-light/50">
          <MapPin size={16} className="text-brand-primary" />
          <div>
            <p className="text-[10px] font-bold text-brand-slate/60 uppercase leading-none">Rancho Activo</p>
            <p className="text-[14px] font-semibold text-brand-slate leading-none mt-1">El Porvenir (Principal)</p>
          </div>
        </div>

        {/* Accesos rápidos en móvil */}
        {onSelectSection && (
          <div className="flex lg:hidden items-center gap-1">
            <button
              type="button"
              onClick={() => onSelectSection('dashboard')}
              className={`p-2 rounded-md ${
                activeSection === 'dashboard' ? 'bg-brand-primary text-white' : 'text-brand-slate/70'
              }`}
              title="Panel Principal"
            >
              <LayoutDashboard size={17} />
            </button>
            <button
              type="button"
              onClick={() => onSelectSection('bovinos')}
              className={`p-2 rounded-md ${
                activeSection === 'bovinos' ? 'bg-brand-primary text-white' : 'text-brand-slate/70'
              }`}
              title="Bovinos"
            >
              <Beef size={17} />
            </button>
            <button
              type="button"
              onClick={() => onSelectSection('salud')}
              className={`p-2 rounded-md ${
                activeSection === 'salud' ? 'bg-brand-primary text-white' : 'text-brand-slate/70'
              }`}
              title="Salud y Tratamientos"
            >
              <Syringe size={17} />
            </button>
          </div>
        )}
      </div>

      <div className="hidden md:flex flex-1 max-w-md mx-8 relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" />
        <input
          type="text"
          placeholder="Buscar por arete SINIIGA, RFID o nombre..."
          className="w-full h-[38px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 focus:outline-none focus:border-brand-primary"
        />
      </div>

      <div className="flex items-center gap-3 md:gap-5">
        <div className="hidden lg:flex items-center gap-2 text-[12px] font-medium mr-2">
          {error ? (
            <span className="flex items-center gap-1.5 text-status-error bg-status-error/10 px-2 py-1 rounded-full">
              <Database size={14} /> Error API
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-status-success bg-status-success/10 px-2 py-1 rounded-full">
              <Wifi size={14} /> En línea
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onSelectSection?.('bovinos')}
          className="hidden sm:flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 h-[38px] rounded-md font-semibold text-[14px] transition-colors shadow-sm"
        >
          <Plus size={18} />
          Nuevo Bovino
        </button>

        <div className="w-px h-6 bg-border-light hidden sm:block"></div>

        <button
          type="button"
          onClick={() => onSelectSection?.('alertas')}
          className="relative text-brand-slate/70 hover:text-brand-primary transition-colors"
          title="Ver Agenda y Alertas Sanitarias"
        >
          <Bell size={20} />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-status-error border-2 border-white rounded-full"></span>
        </button>

        <button
          type="button"
          className="w-8 h-8 rounded-full bg-brand-forest text-white flex items-center justify-center font-bold text-[14px] uppercase"
        >
          CR
        </button>
      </div>
    </header>
  )
}
