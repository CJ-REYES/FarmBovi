import { HeartPulse, Plus, Baby } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function ReproductionPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Eficiencia Reproductiva</span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Reproducción y Cría</h1>
        </div>
        <button className="flex items-center gap-2 bg-pink-600 text-white px-4 h-[38px] rounded-md font-semibold text-[13px] hover:bg-pink-700 transition-colors">
          <Plus size={16} /> Registrar Evento Reproductivo
        </button>
      </header>

      {/* Grid Kanban de 3 columnas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[500px]">
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col">
          <div className="p-4 border-b border-border-light bg-surface-secondary/50 font-bold text-brand-slate text-[14px]">Servicios e Inseminaciones</div>
          <div className="flex-1 p-4"><EmptyState title="Sin registros" message="Integración pendiente." icon={HeartPulse} /></div>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col border-t-4 border-t-pink-500">
          <div className="p-4 border-b border-border-light font-bold text-brand-slate text-[14px]">Gestaciones Confirmadas</div>
          <div className="flex-1 p-4"><EmptyState title="Sin diagnósticos" message="Las palpaciones confirmadas aparecerán aquí." icon={HeartPulse} /></div>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col">
          <div className="p-4 border-b border-border-light bg-surface-secondary/50 font-bold text-brand-slate text-[14px]">Partos y Nacimientos</div>
          <div className="flex-1 p-4"><EmptyState title="Sin nacimientos" message="El seguimiento de crías está desactivado." icon={Baby} /></div>
        </div>
      </div>
    </div>
  );
}
