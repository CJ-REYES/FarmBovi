import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Map, Activity,
  Beef, Scale, Syringe, HeartPulse, Dna, Camera,
  Bell, FileText, Settings, UserCircle, X, type LucideIcon
} from 'lucide-react';

interface MenuItem {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  count?: number | null;
  alert?: boolean;
}

interface MenuGroup {
  category: string;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    category: "GENERAL",
    items: [{ id: 'dashboard', path: '/dashboard', label: 'Panel Principal', icon: LayoutDashboard }]
  },
  {
    category: "GANADO",
    items: [
      { id: 'bovinos', path: '/cattle', label: 'Bovinos', icon: Beef, count: null },
      { id: 'lotes', path: '/lots', label: 'Lotes y Potreros', icon: Map, count: null },
      { id: 'trazabilidad', path: '/traceability', label: 'Trazabilidad', icon: Activity, count: null }
    ]
  },
  {
    category: "MANEJO GANADERO",
    items: [
      { id: 'pesajes', path: '/weighing', label: 'Pesajes', icon: Scale },
      { id: 'salud', path: '/health', label: 'Salud y Tratamientos', icon: Syringe },
      { id: 'reproduccion', path: '/reproduction', label: 'Reproducción', icon: HeartPulse },
      { id: 'genealogia', path: '/genealogy', label: 'Genealogía', icon: Dna },
      { id: 'captura', path: '/boviscale', label: 'Captura Fotográfica', icon: Camera }
    ]
  },
  {
    category: "SEGUIMIENTO",
    items: [
      { id: 'alertas', path: '/alerts', label: 'Alertas', icon: Bell, alert: true },
      { id: 'reportes', path: '/reports', label: 'Reportes', icon: FileText }
    ]
  }
];

export default function Sidebar({ onCloseMobile }: { onCloseMobile: () => void }) {
  return (
    <aside className="flex flex-col w-[260px] h-full bg-surface-white border-r border-border-light shadow-[1px_0_4px_rgba(0,0,0,0.02)]">
      <div className="h-[64px] min-h-[64px] flex items-center justify-between px-6 border-b border-border-light">
        <span className="font-condensed text-2xl font-bold text-brand-primary tracking-wide">
          FARM<span className="text-brand-slate">BOVI</span>
        </span>
        <button onClick={onCloseMobile} className="lg:hidden p-1 text-brand-slate/60 hover:text-brand-slate bg-surface-secondary rounded">
          <X size={20} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 scrollbar-thin">
        {MENU_GROUPS.map((group, idx) => (
          <div key={idx} className="mb-6">
            <h3 className="px-6 mb-2 text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              {group.category}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <NavLink
                      to={item.path}
                      onClick={onCloseMobile}
                      className={({ isActive }) => `
                        w-full flex items-center justify-between px-6 py-2.5 transition-colors
                        ${isActive
                          ? 'bg-brand-primary/10 border-l-4 border-brand-primary text-brand-primary'
                          : 'border-l-4 border-transparent text-brand-slate hover:bg-surface-secondary/50'
                        }
                      `}
                    >
                      {({ isActive }) => (
                        <>
                          <div className="flex items-center gap-3">
                            <Icon size={18} className={isActive ? 'text-brand-primary' : 'text-brand-slate/70'} strokeWidth={isActive ? 2.5 : 2} />
                            <span className={`text-[14px] ${isActive ? 'font-semibold' : 'font-medium'}`}>
                              {item.label}
                            </span>
                          </div>
                          {item.alert && <span className="w-2 h-2 rounded-full bg-status-error"></span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer Settings/Profile adaptados al router */}
      <div className="p-4 border-t border-border-light space-y-1">
        <NavLink to="/settings" onClick={onCloseMobile} className={({ isActive }) => `w-full flex items-center gap-3 px-2 py-2 text-[14px] font-medium rounded-md transition-colors ${isActive ? 'bg-surface-secondary text-brand-primary' : 'text-brand-slate hover:bg-surface-secondary'}`}>
          <Settings size={18} /> Configuración
        </NavLink>
        <NavLink to="/profile" onClick={onCloseMobile} className={({ isActive }) => `w-full flex items-center gap-3 px-2 py-2 text-[14px] font-medium rounded-md transition-colors ${isActive ? 'bg-surface-secondary text-brand-primary' : 'text-brand-slate hover:bg-surface-secondary'}`}>
          <UserCircle size={18} /> Mi Perfil
        </NavLink>
      </div>
    </aside>
  );
}
