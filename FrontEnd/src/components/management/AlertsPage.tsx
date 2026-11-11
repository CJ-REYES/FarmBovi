import { useState } from 'react';
import { Bell, Filter, CheckCircle, AlertTriangle, Info, Clock } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function AlertsPage() {
  const [activeFilter, setActiveFilter] = useState('todas');

  return (
    <div className="space-y-6 animate-in fade-in duration-300 h-full flex flex-col pb-8">
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Seguimiento Operativo</span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1 flex items-center gap-3">
          Alertas y Recordatorios
        </h1>
      </header>

      <div className="flex flex-col md:flex-row gap-6 flex-1">
        {/* Panel lateral de filtros */}
        <aside className="w-full md:w-64 shrink-0 space-y-2">
          <div className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-widest mb-3 px-2 flex items-center gap-2">
            <Filter size={14} /> Filtros de Prioridad
          </div>
          {[
            { id: 'todas', label: 'Todas las Alertas', icon: Bell, color: 'text-brand-slate' },
            { id: 'sanitarias', label: 'Sanitarias (Urgentes)', icon: AlertTriangle, color: 'text-status-error' },
            { id: 'reproduccion', label: 'Reproducción', icon: CheckCircle, color: 'text-pink-600' },
            { id: 'operativas', label: 'Recordatorios', icon: Clock, color: 'text-status-info' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                activeFilter === f.id ? 'bg-surface-white border border-border-light shadow-sm text-brand-primary' : 'text-brand-slate hover:bg-surface-secondary/50 border border-transparent'
              }`}
            >
              <f.icon size={16} className={activeFilter === f.id ? 'text-brand-primary' : f.color} />
              {f.label}
            </button>
          ))}
        </aside>

        {/* Contenedor Principal de Alertas */}
        <div className="flex-1 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[400px]">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex justify-between items-center">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <Bell size={18} className="text-brand-primary" /> Bandeja de Entrada
            </h2>
          </div>
          <div className="flex-1 p-6 flex flex-col justify-center">
            <EmptyState
              title="Bandeja Limpia"
              message="El motor de reglas sanitarias y recordatorios está en proceso de integración. No tienes alertas pendientes."
              icon={Info}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
