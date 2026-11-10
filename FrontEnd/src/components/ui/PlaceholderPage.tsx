import { Hammer } from 'lucide-react';
import { EmptyState } from './EmptyState';

export default function PlaceholderPage({ title, module }: { title: string, module: string }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 h-[calc(100vh-140px)] flex flex-col">
      <header className="flex flex-col gap-1">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">{module}</span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed">{title}</h1>
      </header>

      <div className="flex-1 bg-surface-white border border-border-light rounded-lg shadow-sm flex items-center justify-center p-8">
        <EmptyState
          title="Módulo en Construcción"
          message={`La interfaz para ${title.toLowerCase()} se encuentra en desarrollo según el diseño original. La conexión con la API de .NET 10 se habilitará próximamente.`}
          icon={Hammer}
        />
      </div>
    </div>
  );
}
