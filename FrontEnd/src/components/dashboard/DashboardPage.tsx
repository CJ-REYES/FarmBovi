import { useCattle } from '../../hooks/useCattle'
import { useSanidad } from '../../hooks/useSanidad'
import type { Cattle } from '../../types/cattle'
import type { NavSection } from '../layout/Sidebar'
import { Beef, Syringe, Scale, AlertTriangle, TrendingUp, ChevronRight, Bell } from 'lucide-react'

interface DashboardPageProps {
  onSelectSection?: (section: NavSection) => void
}

export function DashboardPage({ onSelectSection }: DashboardPageProps) {
  const { cattle, error } = useCattle()
  const { eventos, tratamientos, recordatorios } = useSanidad()

  const totalBovinos = cattle?.length || 0
  const machos =
    cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Macho' || c.sex === 'Macho')
      .length || 0
  const hembras =
    cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Hembra' || c.sex === 'Hembra')
      .length || 0

  const alertasPendientes = recordatorios.filter((r) => r.estado === 'Pendiente').length
  const tratamientosActivos = tratamientos.filter(
    (t) => t.estado === 'En curso' || t.estado === 'Programado'
  ).length

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed">Resumen del Hato</h1>
          <p className="text-brand-slate/70 text-[15px] mt-1">
            Métricas principales y estado general del Rancho El Porvenir.
          </p>
        </div>

        {onSelectSection && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSelectSection('salud')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-brand-primary text-white text-xs font-semibold hover:bg-brand-dark transition-colors shadow-xs"
            >
              <Syringe size={15} /> Salud y Tratamientos
            </button>
            <button
              type="button"
              onClick={() => onSelectSection('alertas')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-brand-slate text-xs font-semibold transition-colors"
            >
              <Bell size={15} className="text-status-error" /> Agenda ({alertasPendientes})
            </button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => onSelectSection?.('bovinos')}
          className="bg-surface-white border border-border-light rounded-lg p-5 shadow-sm relative overflow-hidden cursor-pointer hover:border-brand-primary/40 transition-colors"
        >
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-brand-slate uppercase tracking-wide">Población Activa</h3>
            <span className="p-2 bg-brand-primary/10 text-brand-primary rounded-md">
              <Beef size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold font-condensed text-brand-forest">{totalBovinos}</span>
            <span className="text-[13px] font-medium text-status-success flex items-center">
              <TrendingUp size={14} className="mr-1" /> Activos
            </span>
          </div>
          <div className="mt-4 flex gap-4 text-[13px] text-brand-slate/60 border-t border-border-light pt-3">
            <span>
              Hembras: <strong className="text-brand-slate">{hembras}</strong>
            </span>
            <span>
              Machos: <strong className="text-brand-slate">{machos}</strong>
            </span>
          </div>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-brand-primary"></div>
        </div>

        <div className="bg-surface-white border border-border-light rounded-lg p-5 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-brand-slate uppercase tracking-wide">GDP Promedio</h3>
            <span className="p-2 bg-surface-secondary text-brand-slate/70 rounded-md">
              <Scale size={18} />
            </span>
          </div>
          <div className="mt-2">
            <span className="text-[14px] text-brand-slate/50 font-medium italic">
              Sin registros de pesaje recientes.
            </span>
          </div>
        </div>

        <div
          onClick={() => onSelectSection?.('salud')}
          className="bg-surface-white border border-border-light rounded-lg p-5 shadow-sm cursor-pointer hover:border-brand-primary/40 transition-colors"
        >
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-brand-slate uppercase tracking-wide">
              Salud y Tratamientos
            </h3>
            <span className="p-2 bg-brand-primary/10 text-brand-primary rounded-md">
              <Syringe size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold font-condensed text-brand-forest">{eventos.length}</span>
            <span className="text-[13px] text-brand-slate/60">eventos clínicos</span>
          </div>
          <div className="mt-4 text-[13px] text-brand-slate/60 border-t border-border-light pt-3">
            Tratamientos en curso: <strong className="text-brand-slate">{tratamientosActivos}</strong>
          </div>
        </div>

        <div
          onClick={() => onSelectSection?.('alertas')}
          className="bg-surface-white border border-status-error/30 rounded-lg p-5 shadow-sm bg-status-error/5 cursor-pointer hover:border-status-error/60 transition-colors"
        >
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-[14px] font-semibold text-status-error uppercase tracking-wide">
              Atención Requerida
            </h3>
            <span className="p-2 bg-status-error/10 text-status-error rounded-md">
              <AlertTriangle size={18} />
            </span>
          </div>
          {error ? (
            <p className="text-[13px] font-medium text-status-error leading-tight mt-2">
              Error de conexión con servidor local.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold font-condensed text-status-error">{alertasPendientes}</span>
                <span className="text-[13px] font-medium text-brand-slate">recordatorios pendientes</span>
              </div>
              <p className="text-[12px] text-brand-slate/70 mt-3 border-t border-status-error/20 pt-2.5">
                Haz clic para abrir la Agenda Sanitaria →
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-surface-white border border-border-light rounded-lg shadow-sm flex flex-col h-[380px]">
          <div className="px-5 py-4 border-b border-border-light flex justify-between items-center">
            <h2 className="font-bold text-[18px] text-brand-slate">Bitácora Sanitaria Reciente</h2>
            <button
              type="button"
              onClick={() => onSelectSection?.('salud')}
              className="text-xs font-semibold text-brand-primary hover:underline"
            >
              Ver módulo completo →
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {eventos.length === 0 ? (
              <div className="h-full flex items-center justify-center p-6 bg-surface-app/50 rounded-lg">
                <div className="text-center bg-white p-6 rounded-lg border border-border-light shadow-sm">
                  <Syringe className="mx-auto mb-3 text-brand-slate/40" size={32} />
                  <h4 className="font-bold text-brand-slate mb-1">Sin eventos sanitarios aún</h4>
                  <p className="text-[13px] text-brand-slate/60 mb-3">
                    Registra vacunaciones, revisiones clínicas o tratamientos del hato.
                  </p>
                  <button
                    type="button"
                    onClick={() => onSelectSection?.('salud')}
                    className="px-3.5 py-1.5 rounded-md bg-brand-primary text-white text-xs font-semibold"
                  >
                    Ir a Salud y Tratamientos
                  </button>
                </div>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {eventos.slice(0, 5).map((ev) => (
                  <li
                    key={ev.idEventoSanitario}
                    onClick={() => onSelectSection?.('salud')}
                    className="p-3.5 rounded-lg border border-border-light hover:bg-surface-app/60 transition-colors cursor-pointer flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-brand-primary/10 text-brand-primary text-xs font-bold">
                          {ev.tipo}
                        </span>
                        <span className="text-[14px] font-semibold text-brand-slate">
                          Arete {ev.animalArete || `#${ev.idAnimal}`}
                        </span>
                      </div>
                      <p className="text-xs text-brand-slate/60 mt-1">
                        Responsable: {ev.responsable} · {ev.tratamientos.length} tratamiento(s)
                      </p>
                    </div>
                    <span className="text-xs text-brand-slate/50 shrink-0">
                      {new Date(ev.fecha).toLocaleDateString('es-MX')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-white border border-border-light rounded-lg shadow-sm flex flex-col h-[380px]">
          <div className="px-5 py-4 border-b border-border-light flex justify-between items-center">
            <h2 className="font-bold text-[18px] text-brand-slate">Bovinos Recientes</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {totalBovinos === 0 ? (
              <div className="p-6 text-center text-[13px] text-brand-slate/50 italic mt-10">
                Sin bovinos registrados.
              </div>
            ) : (
              <ul className="space-y-1">
                {cattle?.slice(0, 5).map((bovino, index) => (
                  <li
                    key={bovino.id || index}
                    onClick={() => onSelectSection?.('bovinos')}
                    className="flex items-start gap-3 p-3 hover:bg-surface-secondary/50 rounded-md transition-colors cursor-pointer group"
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary shrink-0 mt-0.5">
                      <Beef size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-brand-slate truncate">
                        Arete {bovino.earTag} {bovino.name ? `— ${bovino.name}` : ''}
                      </p>
                      <p className="text-[12px] text-brand-slate/60 truncate">
                        {bovino.breed} · {bovino.sex}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      className="text-brand-slate/30 group-hover:text-brand-primary transition-colors mt-2"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
