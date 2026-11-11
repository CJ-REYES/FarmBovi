import { Activity } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function TraceabilityPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 h-full flex flex-col">
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Historial Operativo</span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Trazabilidad y Movimientos</h1>
      </header>
      <div className="flex-1 bg-surface-white border border-border-light rounded-xl shadow-sm flex items-center justify-center p-8">
        <EmptyState title="Línea de Tiempo Vacía" message="Los movimientos, entradas, salidas y transferencias se auditarán aquí. API pendiente de integración." icon={Activity} />
      </div>
    </div>
  );
}
