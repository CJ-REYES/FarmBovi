import { Plus, Search, MapPin } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import { db } from '../../lib/database/db';
import { useLocalServerRecords } from '../../hooks/use-local-server-records';

export default function LotsPage() {
  const lots = useLocalServerRecords(db.lots);
  return (
    <div className="space-y-6 animate-in fade-in duration-300 h-full flex flex-col">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Organización del Rancho</span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Gestión de Lotes y Potreros</h1>
        </div>
        <button className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 h-[38px] rounded-md font-semibold text-[13px] transition-colors shadow-sm disabled:opacity-50">
          <Plus size={16} /> Crear Lote
        </button>
      </header>

      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 flex gap-4">
        <div className="relative w-full md:max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" />
          <input type="text" placeholder="Buscar lote por nombre o clave..." className="w-full h-[38px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] outline-none focus:border-brand-primary" />
        </div>
      </div>

      <div className="flex-1 bg-surface-white border border-border-light rounded-xl shadow-sm p-5 min-h-[400px]">
        {lots.length === 0 ? <EmptyState title="Cero Lotes Configurados" message="Los lotes recibidos del servidor aparecerán aquí." icon={MapPin} /> :
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{lots.map(lot => <article key={lot.id} className="rounded-lg border border-border-light p-4"><h2 className="font-bold text-brand-forest">{lot.nombre}</h2><p className="text-sm text-brand-slate">{lot.ubicacion || 'Sin ubicación'}</p><p className="mt-2 text-xs text-brand-slate/70">Capacidad: {lot.capacidad || 'Sin especificar'}</p></article>)}</div>}
      </div>
    </div>
  );
}
