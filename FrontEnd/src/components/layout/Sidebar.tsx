import {
  LayoutDashboard, Map, Activity,
  Beef, Scale, Syringe, HeartPulse, Dna, Camera,
  Bell, FileText, Settings, UserCircle, type LucideIcon
} from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
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
    items: [{ id: 'dashboard', label: 'Panel Principal', icon: LayoutDashboard, active: true }]
  },
  {
    category: "GANADO",
    items: [
      { id: 'bovinos', label: 'Bovinos', icon: Beef, count: null },
      { id: 'lotes', label: 'Lotes y Potreros', icon: Map, count: null },
      { id: 'trazabilidad', label: 'Trazabilidad', icon: Activity, count: null }
    ]
  },
  {
    category: "MANEJO GANADERO",
    items: [
      { id: 'pesajes', label: 'Pesajes', icon: Scale },
      { id: 'salud', label: 'Salud y Tratamientos', icon: Syringe },
      { id: 'reproduccion', label: 'Reproducción', icon: HeartPulse },
      { id: 'genealogia', label: 'Genealogía', icon: Dna },
      { id: 'captura', label: 'Captura Fotográfica', icon: Camera }
    ]
  },
  {
    category: "SEGUIMIENTO",
    items: [
      { id: 'alertas', label: 'Alertas', icon: Bell, alert: true },
      { id: 'reportes', label: 'Reportes', icon: FileText }
    ]
  }
];

export default function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-[260px] h-full bg-surface-white border-r border-border-light shadow-[1px_0_4px_rgba(0,0,0,0.02)] z-10">
      <div className="h-[64px] flex items-center px-6 border-b border-border-light">
        <span className="font-condensed text-2xl font-bold text-brand-primary tracking-wide">
          FARM<span className="text-brand-slate">BOVI</span>
        </span>
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
                    <button className={`w-full flex items-center justify-between px-6 py-2.5 transition-colors ${
                      item.active
                        ? 'bg-brand-primary/10 border-l-4 border-brand-primary text-brand-primary'
                        : 'border-l-4 border-transparent text-brand-slate hover:bg-surface-secondary/50'
                    }`}>
                      <div className="flex items-center gap-3">
                        <Icon size={18} className={item.active ? 'text-brand-primary' : 'text-brand-slate/70'} strokeWidth={item.active ? 2.5 : 2} />
                        <span className={`text-[14px] ${item.active ? 'font-semibold' : 'font-medium'}`}>
                          {item.label}
                        </span>
                      </div>
                      {item.alert && <span className="w-2 h-2 rounded-full bg-status-error"></span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-border-light space-y-1">
        <button className="w-full flex items-center gap-3 px-2 py-2 text-[14px] font-medium text-brand-slate hover:bg-surface-secondary rounded-md">
          <Settings size={18} className="text-brand-slate/70" /> Configuración
        </button>
        <button className="w-full flex items-center gap-3 px-2 py-2 text-[14px] font-medium text-brand-slate hover:bg-surface-secondary rounded-md">
          <UserCircle size={18} className="text-brand-slate/70" /> Mi Perfil
        </button>
      </div>
    </aside>
  );
}
