import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCattle } from '../../hooks/useCattle';
import { FeedingRepository } from '../../lib/database/repositories/feeding.repository';
import { WeighingRepository } from '../../lib/database/repositories/weighing.repository';
import { WeighingService } from '../../services/weighing.service';
import { computeWeightAnalytics } from '../../services/weighing.validation';
import type { LocalFeedingRecord } from '../../lib/database/schema';
import type { Weighing } from '../../types/weighing';
import KpiCard from './KpiCard';
import EmptyState from '../ui/EmptyState';
import WeightEvolutionChart from '../management/WeightEvolutionChart';
import {
  Beef, Scale, Activity, AlertTriangle, TrendingUp, ChevronRight,
  Map, PieChart, Wheat, ClipboardList, Stethoscope, Plus
} from 'lucide-react';

export function DashboardPage() {
  const navigate = useNavigate();
  // CORRECCIÓN 1: Usamos 'loading' en lugar de 'isLoading' según la firma de tu hook
  const { cattle, loading } = useSharedCattle();
  const [recentFeeding, setRecentFeeding] = useState<LocalFeedingRecord[]>([]);
  const [weighings, setWeighings] = useState<Weighing[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [feedingItems, weighingItems] = await Promise.all([
          FeedingRepository.getAllWithOptions({ includeDeleted: false, order: 'desc' }),
          WeighingRepository.getAllWithOptions({ includeDeleted: false, order: 'asc' })
        ]);
        if (active) {
          setRecentFeeding(feedingItems.slice(0, 4));
          setWeighings(weighingItems.map((w) => WeighingService.toWeighing(w)));
        }
      } catch {
        // Mantener vacío si IndexedDB no está disponible
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const weightAnalytics = useMemo(
    () => computeWeightAnalytics(weighings, cattle || []),
    [weighings, cattle]
  );

  const totalBovinos = cattle?.length || 0;
  const machos = cattle?.filter((c) => c.sexo === 'Macho').length || 0;
  const hembras = cattle?.filter((c) => c.sexo === 'Hembra').length || 0;

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
          value={
            weightAnalytics.averageGdpKgDay !== null
              ? `${weightAnalytics.averageGdpKgDay > 0 ? '+' : ''}${weightAnalytics.averageGdpKgDay.toFixed(2)}`
              : '--.-'
          }
          unit="kg/día"
          sub={
            weightAnalytics.latestWeighing
              ? `Último pesaje: ${weightAnalytics.latestWeighing.pesoRealKg.toFixed(1)} kg`
              : 'Sin registros históricos recientes'
          }
          color={weightAnalytics.averageGdpKgDay !== null ? 'bg-brand-primary' : 'bg-brand-slate/30'}
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
        <div className="lg:col-span-8 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[380px] overflow-hidden">
          <div className="px-5 py-4 border-b border-border-light flex justify-between items-center bg-surface-app/30">
            <div>
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <TrendingUp size={18} className="text-brand-primary" /> Evolución de Pesos y Ganancia
              </h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/weighing')}
              className="text-[12px] font-semibold text-brand-primary hover:underline cursor-pointer"
            >
              Ir a Pesajes
            </button>
          </div>
          <div className="flex-1 p-5 flex flex-col justify-center">
            <WeightEvolutionChart
              points={weightAnalytics.evolutionPoints}
              subtitle={`Promedio real del hato (${weightAnalytics.evolutionPoints.length} jornada(s))`}
              emptyActionLabel="Ir a Pesajes"
              onEmptyAction={() => navigate('/weighing')}
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
          <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
            <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
              <Wheat size={18} className="text-brand-yellow" /> Alimentación Diaria
            </h2>
            <button
              type="button"
              onClick={() => navigate('/feeding')}
              className="text-[12px] font-semibold text-brand-primary hover:underline cursor-pointer"
            >
              Ver módulo
            </button>
          </div>
          <div className="flex-1 p-4 overflow-y-auto">
            {recentFeeding.length === 0 ? (
              <EmptyState
                title="Sin registros de alimentación"
                message="Registra suministros por potrero o animal individual desde el módulo de alimentación."
                icon={Wheat}
                actionLabel="Ir a Alimentación"
                onAction={() => navigate('/feeding')}
              />
            ) : (
              <ul className="divide-y divide-border-light/60 text-[13px]">
                {recentFeeding.map((item) => (
                  <li
                    key={item.id}
                    onClick={() => navigate('/feeding')}
                    className="py-2.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-app/60 px-2 rounded-md transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-forest truncate">
                        {item.tipoAlimento}
                      </p>
                      <p className="text-[11px] text-brand-slate/65 truncate">
                        {item.racion || item.tipoAlimento} • {item.frecuencia || 'Diaria'}
                      </p>
                    </div>
                    <span className="text-[12px] font-bold text-brand-slate shrink-0">
                      {item.cantidadKg} {item.unidad || 'kg'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
                 {cattle?.slice(0, 4).map((bovino) => (
                   <li
                     key={bovino.id}
                     onClick={() => navigate(`/cattle/${bovino.id}`)}
                     className="flex items-center gap-4 p-3 hover:bg-surface-secondary/50 transition-colors cursor-pointer group"
                   >
                     <div className="w-10 h-10 rounded-full bg-surface-secondary border border-border-light flex items-center justify-center text-brand-slate shrink-0">
                       <Beef size={18} />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-[14px] font-semibold text-brand-slate truncate">
                         Registro en Padrón: {bovino.arete || bovino.id}
                       </p>
                       <p className="text-[12px] text-brand-slate/60 truncate">
                         {bovino.raza || 'Bovino'} • {bovino.sexo} • {bovino.estado}
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
