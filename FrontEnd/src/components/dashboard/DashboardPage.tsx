import { useCattle } from '../../hooks/useCattle';
import type { Cattle } from '../../types/cattle';
import { Beef, Activity, Scale, AlertTriangle, TrendingUp, ChevronRight } from 'lucide-react';

export function DashboardPage() {
  const { cattle, error } = useCattle();

  const totalBovinos = cattle?.length || 0;
  const machos = cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Macho' || c.sex === 'Macho').length || 0;
  const hembras = cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Hembra' || c.sex === 'Hembra').length || 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed">Resumen del Hato</h1>
          <p className="text-brand-slate/70 text-[15px] mt-1">
            Métricas principales y estado general del Rancho El Porvenir.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-white border border-border-light rounded-lg p-5 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-brand-slate uppercase tracking-wide">Población Activa</h3>
            <span className="p-2 bg-brand-primary/10 text-brand-primary rounded-md"><Beef size={18} /></span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold font-condensed text-brand-forest">{totalBovinos}</span>
            <span className="text-[13px] font-medium text-status-success flex items-center"><TrendingUp size={14} className="mr-1"/> +2% m/m</span>
          </div>
          <div className="mt-4 flex gap-4 text-[13px] text-brand-slate/60 border-t border-border-light pt-3">
            <span>Hembras: <strong className="text-brand-slate">{hembras}</strong></span>
            <span>Machos: <strong className="text-brand-slate">{machos}</strong></span>
          </div>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-brand-primary"></div>
        </div>

        <div className="bg-surface-white border border-border-light rounded-lg p-5 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-brand-slate uppercase tracking-wide">GDP Promedio</h3>
            <span className="p-2 bg-surface-secondary text-brand-slate/70 rounded-md"><Scale size={18} /></span>
          </div>
          <div className="mt-2">
             <span className="text-[14px] text-brand-slate/50 font-medium italic">Sin registros de pesaje recientes.</span>
          </div>
        </div>

         <div className="bg-surface-white border border-border-light rounded-lg p-5 shadow-sm opacity-70">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-brand-slate uppercase tracking-wide">Preñez Estimada</h3>
            <span className="p-2 bg-surface-secondary text-brand-slate/70 rounded-md"><Activity size={18} /></span>
          </div>
          <div className="mt-4">
             <span className="text-[12px] bg-surface-secondary px-2 py-1 rounded text-brand-slate/60">Módulo en desarrollo</span>
          </div>
        </div>

        <div className="bg-surface-white border border-status-error/30 rounded-lg p-5 shadow-sm bg-status-error/5">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-status-error uppercase tracking-wide">Atención Requerida</h3>
            <span className="p-2 bg-status-error/10 text-status-error rounded-md"><AlertTriangle size={18} /></span>
          </div>
           {error ? (
              <p className="text-[13px] font-medium text-status-error leading-tight mt-2">Error de conexión con servidor local.</p>
           ) : (
              <p className="text-[13px] font-medium text-brand-slate leading-tight mt-2">0 alertas sanitarias pendientes.</p>
           )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-surface-white border border-border-light rounded-lg shadow-sm flex flex-col h-[380px]">
          <div className="px-5 py-4 border-b border-border-light flex justify-between items-center">
            <h2 className="font-bold text-[18px] text-brand-slate">Evolución de Pesos y Ganancia</h2>
          </div>
          <div className="flex-1 flex items-center justify-center p-6 bg-surface-app/50">
             <div className="text-center bg-white p-6 rounded-lg border border-border-light shadow-sm">
                <Scale className="mx-auto mb-3 text-brand-slate/40" size={32} />
                <h4 className="font-bold text-brand-slate mb-1">Gráfica no disponible</h4>
                <p className="text-[13px] text-brand-slate/60">Registra al menos 2 pesajes para generar la curva.</p>
             </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-white border border-border-light rounded-lg shadow-sm flex flex-col h-[380px]">
          <div className="px-5 py-4 border-b border-border-light flex justify-between items-center">
            <h2 className="font-bold text-[18px] text-brand-slate">Actividad Reciente</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {totalBovinos === 0 ? (
               <div className="p-6 text-center text-[13px] text-brand-slate/50 italic mt-10">Sin actividad registrada.</div>
            ) : (
               <ul className="space-y-1">
                 {cattle?.slice(0, 5).map((bovino: Cattle & { tagNumber?: string; areteSiniiga?: string; breed?: string; raza?: string }, index: number) => (
                   <li key={bovino.id || index} className="flex items-start gap-3 p-3 hover:bg-surface-secondary/50 rounded-md transition-colors cursor-pointer group">
                     <div className="w-8 h-8 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary shrink-0 mt-0.5">
                       <Beef size={16} />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-[14px] font-semibold text-brand-slate truncate">
                         Registro: Arete {bovino.tagNumber || bovino.areteSiniiga || bovino.id}
                       </p>
                       <p className="text-[12px] text-brand-slate/60 truncate">{bovino.breed || bovino.raza || 'Bovino'}</p>
                     </div>
                     <ChevronRight size={16} className="text-brand-slate/30 group-hover:text-brand-primary transition-colors mt-2" />
                   </li>
                 ))}
               </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
