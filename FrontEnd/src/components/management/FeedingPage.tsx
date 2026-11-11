import { Wheat, Plus, ClipboardList } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function FeedingPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex justify-between border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Nutrición</span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Alimentación y Raciones</h1>
        </div>
        <button className="flex items-center gap-2 bg-brand-yellow text-brand-dark px-4 h-[38px] rounded-md font-semibold text-[13px]"><Plus size={16} /> Nueva Ración</button>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[400px]">
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col"><div className="p-4 border-b border-border-light font-bold">Catálogo de Raciones</div><div className="flex-1 p-4"><EmptyState title="Sin dietas" message="No has configurado tipos de alimento." icon={Wheat} /></div></div>
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col"><div className="p-4 border-b border-border-light font-bold">Asignación a Lotes</div><div className="flex-1 p-4"><EmptyState title="Sin asignaciones" message="Requiere módulo de lotes activo." icon={ClipboardList} /></div></div>
      </div>
    </div>
  );
}
