import { Syringe, ShieldCheck, Calendar, Plus } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function HealthPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Manejo Sanitario</span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Salud y Tratamientos</h1>
        </div>
        <button className="flex items-center gap-2 bg-status-info text-white px-4 h-[38px] rounded-md font-semibold text-[13px] shadow-sm hover:bg-blue-700">
          <Plus size={16} /> Aplicar Tratamiento
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Expedientes Activos */}
        <div className="lg:col-span-8 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[500px]">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <ShieldCheck size={18} className="text-status-info" /> Diagnósticos y Tratamientos Activos
            </h2>
          </div>
          <div className="flex-1 p-6"><EmptyState title="Hato Saludable" message="No hay expedientes clínicos abiertos ni diagnósticos registrados. El módulo de sanidad está en fase de integración." icon={Syringe} /></div>
        </div>

        {/* Calendario de Vacunación */}
        <div className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[500px]">
          <div className="px-5 py-4 border-b border-border-light">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <Calendar size={18} className="text-brand-slate/70" /> Próximas Aplicaciones
            </h2>
          </div>
          <div className="flex-1 p-6"><EmptyState title="Calendario Libre" message="Sin vacunas ni desparasitaciones programadas." icon={Calendar} /></div>
        </div>
      </div>
    </div>
  );
}
