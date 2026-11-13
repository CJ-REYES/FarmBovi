import { useNavigate } from 'react-router-dom';
import { useSharedCattle } from '../../context/CattleContext';
import type { Cattle } from '../../types/cattle';
import KpiCard from './KpiCard';
import EmptyState from '../ui/EmptyState';
import {
  Beef, Scale, Activity, AlertTriangle, TrendingUp, ChevronRight,
  Map, PieChart, Wheat, ClipboardList, Stethoscope, Plus
} from 'lucide-react';

export function DashboardPage() {
  const navigate = useNavigate();
  // CORRECCIÓN 1: Usamos 'loading' en lugar de 'isLoading' según la firma de tu hook
  const { cattle, loading } = useSharedCattle();

  const totalBovinos = cattle?.length || 0;
  const machos = cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Macho' || c.sex === 'Macho').length || 0;
  const hembras = cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Hembra' || c.sex === 'Hembra').length || 0;

  const pctMachos = totalBovinos > 0 ? Math.round((machos / totalBovinos) * 100) : 0;
  const pctHembras = totalBovinos > 0 ? Math.round((hembras / totalBovinos) * 100) : 0;

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">

      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 bg-brand-primary/10 text-brand-primary rounded text-[11px] font-bold uppercase tracking-wider">
              Contexto Operativo
            </span>
            <span className="text-[12px] font-medium text-brand-slate/60">Rancho El Porvenir • Temporada de Lluvias</span>
          </div>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight">
            Resumen del Rancho
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/cattle/new')}
            className="flex items-center gap-2 bg-surface-white border border-border-light hover:border-brand-primary/50 text-brand-slate px-4 h-[38px] rounded-md font-semibold text-[13px] transition-colors shadow-sm"
          >
            <Plus size={16} className="text-brand-primary" /> Nuevo Registro
          </button>
          <button
            onClick={() => navigate('/weighing')}
            className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 h-[38px] rounded-md font-semibold text-[13px] transition-colors shadow-sm"
          >
            <Scale size={16} /> Capturar Pesaje
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Población Activa"
          icon={Beef}
          value={loading ? '...' : totalBovinos.toString()}
          unit="Cabezas"
          sub={`Hembras: ${hembras} | Machos: ${machos}`}
          color="bg-brand-primary"
        />
        <KpiCard
          title="GDP Promedio"
          icon={Scale}
          value="--.-"
          unit="kg/día"
          sub="Sin registros históricos recientes"
          color="bg-brand-slate/30"
        />
        <KpiCard
          title="Tasa de Preñez"
          icon={Activity}
          value="--%"
          sub="Módulo de reproducción pendiente"
          color="bg-brand-slate/30"
        />
        <KpiCard
          title="Alertas Activas"
          icon={AlertTriangle}
          value="0"
          unit="Pendientes"
          sub="Sanidad y recordatorios al día"
          color="bg-status-warning"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[380px] overflow-hidden">
          <div className="px-5 py-4 border-b border-border-light flex justify-between items-center bg-surface-app/30">
            <div>
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <TrendingUp size={18} className="text-brand-primary" /> Evolución de Pesos y Ganancia
              </h2>
            </div>
            <select className="text-[12px] font-medium border border-border-light rounded px-2 py-1 bg-surface-white text-brand-slate outline-none focus:border-brand-primary">
              <option>Últimos 6 meses</option>
            </select>
          </div>
          <div className="flex-1 p-6 flex flex-col">
            <EmptyState
              title="Gráfica no disponible"
              message="Registra al menos 2 pesajes oficiales para generar la curva de crecimiento."
              icon={Scale}
              actionLabel="Ir a Pesajes"
            />
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[380px] overflow-hidden">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <AlertTriangle size={18} className="text-status-warning" /> Panel de Alertas
            </h2>
          </div>
          <div className="flex-1 p-6">
            <EmptyState
              title="Hato Saludable"
              message="No hay alertas sanitarias ni tratamientos vencidos registrados actualmente."
              icon={Stethoscope}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[300px]">
          <div className="px-5 py-4 border-b border-border-light">
            <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
               Distribución por Lotes
            </h2>
          </div>
          <div className="flex-1 p-5">
            <EmptyState
              title="Sin asignaciones"
              message="No se han configurado potreros o lotes en el sistema."
              icon={Map}
            />
          </div>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[300px]">
          <div className="px-5 py-4 border-b border-border-light">
            <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
              <PieChart size={18} className="text-brand-primary" /> Categorías del Hato
            </h2>
          </div>
          <div className="flex-1 p-5 flex flex-col justify-center">
            {totalBovinos === 0 ? (
              <EmptyState title="Sin registros" message="Agrega bovinos para ver la distribución." icon={PieChart} />
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="flex justify-between text-[13px] font-semibold text-brand-slate mb-1">
                    <span>Hembras</span>
                    <span>{hembras} ({pctHembras}%)</span>
                  </div>
                  <div className="w-full bg-surface-secondary rounded-full h-2.5">
                    <div className="bg-brand-primary h-2.5 rounded-full" style={{ width: `${pctHembras}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[13px] font-semibold text-brand-slate mb-1">
                    <span>Machos</span>
                    <span>{machos} ({pctMachos}%)</span>
                  </div>
                  <div className="w-full bg-surface-secondary rounded-full h-2.5">
                    <div className="bg-brand-yellow h-2.5 rounded-full" style={{ width: `${pctMachos}%` }}></div>
                  </div>
                </div>
                <div className="pt-4 border-t border-border-light text-center">
                  <span className="text-[12px] font-medium text-brand-slate/60">Total: {totalBovinos} cabezas registradas</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[300px]">
          <div className="px-5 py-4 border-b border-border-light">
            <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
              <Wheat size={18} className="text-brand-yellow" /> Alimentación Diaria
            </h2>
          </div>
          <div className="flex-1 p-5">
            <EmptyState
              title="Módulo Pendiente"
              message="La gestión de raciones y suplementos aún no está sincronizada."
              icon={Wheat}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[300px]">
          <div className="px-5 py-4 border-b border-border-light flex justify-between items-center">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <ClipboardList size={18} className="text-brand-primary" /> Actividad Reciente (Altas)
            </h2>
            <button onClick={() => navigate('/cattle')} className="text-[12px] font-semibold text-brand-primary hover:underline">
              Ver Padrón Completo
            </button>
          </div>
          <div className="flex-1 p-2">
            {loading ? (
               <div className="p-8 text-center text-[13px] text-brand-slate/50">Cargando registros...</div>
            ) : totalBovinos === 0 ? (
               <div className="p-8"><EmptyState title="Bitácora Vacía" message="No hay actividad reciente en el rancho." icon={ClipboardList} /></div>
            ) : (
               <ul className="divide-y divide-border-light/50">
                 {/* CORRECCIÓN 2: Extendemos el tipado añadiendo gender y sex al inline type */}
                 {cattle?.slice(0, 4).map((bovino: Cattle & { tagNumber?: string; areteSiniiga?: string; breed?: string; raza?: string; gender?: string; sex?: string }, index: number) => (
                   <li key={bovino.id || index} className="flex items-center gap-4 p-3 hover:bg-surface-secondary/50 transition-colors cursor-pointer group">
                     <div className="w-10 h-10 rounded-full bg-surface-secondary border border-border-light flex items-center justify-center text-brand-slate shrink-0">
                       <Beef size={18} />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-[14px] font-semibold text-brand-slate truncate">
                         Registro en Padrón: {bovino.tagNumber || bovino.areteSiniiga || `ID-${bovino.id}`}
                       </p>
                       <p className="text-[12px] text-brand-slate/60 truncate">
                         {bovino.breed || bovino.raza || 'Bovino'} • {bovino.gender || bovino.sex || 'Sin clasificar'}
                       </p>
                     </div>
                     <div className="text-[12px] font-medium text-brand-slate/40 px-4">
                       Alta reciente
                     </div>
                     <ChevronRight size={18} className="text-brand-slate/30 group-hover:text-brand-primary transition-colors" />
                   </li>
                 ))}
               </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[300px]">
          <div className="px-5 py-4 border-b border-border-light">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <Activity size={18} className="text-brand-primary" /> Tareas de Seguimiento
            </h2>
          </div>
          <div className="flex-1 p-6">
            <EmptyState
              title="Sin tareas pendientes"
              message="Las actividades programadas de vacunación o destete aparecerán aquí."
              icon={Activity}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
