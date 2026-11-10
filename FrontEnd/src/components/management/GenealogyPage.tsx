import { Dna } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function GenealogyPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 h-full flex flex-col">
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Líneas Genéticas</span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Genealogía y Parentesco</h1>
      </header>
      <div className="flex-1 bg-surface-white border border-border-light rounded-xl shadow-sm flex items-center justify-center p-8">
        <EmptyState title="Árbol Genealógico Inactivo" message="Identifica padre y madre en el expediente de cada bovino para generar las relaciones de parentesco. Backend no disponible." icon={Dna} />
      </div>
    </div>
  );
}
