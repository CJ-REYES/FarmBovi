import { Scale, Plus, TrendingUp, History } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function WeighingPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Biometría y Rendimiento</span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Pesajes y Crecimiento</h1>
        </div>
        <button className="flex items-center gap-2 bg-brand-primary text-white px-4 h-[38px] rounded-md font-semibold text-[13px] shadow-sm hover:bg-brand-dark">
          <Plus size={16} /> Registrar Pesaje Oficial
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Curva de Crecimiento */}
        <div className="lg:col-span-12 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[350px]">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex justify-between items-center">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <TrendingUp size={18} className="text-brand-primary" /> Evolución del Hato (GDP)
            </h2>
          </div>
          <div className="flex-1 p-6"><EmptyState title="Datos Insuficientes" message="La ganancia diaria de peso (GDP) se calculará automáticamente cuando existan al menos dos pesajes válidos por bovino." icon={Scale} /></div>
        </div>

        {/* Historial de Pesajes */}
        <div className="lg:col-span-12 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[300px]">
          <div className="px-5 py-4 border-b border-border-light flex items-center gap-2">
            <History size={18} className="text-brand-slate/70" />
            <h2 className="font-bold text-[16px] text-brand-slate">Historial Biométrico Reciente</h2>
          </div>
          <div className="flex-1 p-8"><EmptyState title="Bitácora Vacía" message="No se han registrado pesajes en el sistema central." icon={History} /></div>
        </div>
      </div>
    </div>
  );
}
