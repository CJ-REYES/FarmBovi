import { useState, type FormEvent } from 'react'
import {
  Syringe,
  Plus,
  Search,
  Calendar,
  UserCheck,
  Stethoscope,
  Pill,
  BellPlus,
  Edit,
  Trash2,
  ShieldAlert,
  ExternalLink,
  X,
  Beef,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { useCattle } from '../../hooks/useCattle'
import { useSanidad } from '../../hooks/useSanidad'
import {
  ESTADOS_TRATAMIENTO,
  TIPOS_EVENTO_SANITARIO,
  TIPOS_RECORDATORIO,
  UNIDADES_DOSIS,
  VIAS_ADMINISTRACION,
  type EventoSanitario,
  type EventoSanitarioInput,
  type RecordatorioInput,
  type Tratamiento,
  type TratamientoInput,
} from '../../types/sanidad'

interface SanidadPageProps {
  onNavigateToAgenda?: () => void
}

function toLocalDateTimeInput(iso?: string | null): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function toNextDayDateTimeInput(): string {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return toLocalDateTimeInput(tomorrow.toISOString())
}

export function SanidadPage({ onNavigateToAgenda }: SanidadPageProps) {
  const { cattle } = useCattle()
  const {
    eventos,
    tratamientos,
    loading,
    error,
    saveEvento,
    removeEvento,
    saveTratamiento,
    removeTratamiento,
    saveRecordatorio,
  } = useSanidad()

  const [searchTerm, setSearchTerm] = useState('')
  const [filterAnimal, setFilterAnimal] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Modal state: EventoSanitario
  const [eventoModalOpen, setEventoModalOpen] = useState(false)
  const [editingEvento, setEditingEvento] = useState<EventoSanitario | null>(null)
  const [eventoForm, setEventoForm] = useState<EventoSanitarioInput>({
    idAnimal: '',
    tipo: 'Vacunación',
    fecha: toLocalDateTimeInput(),
    sintomas: '',
    diagnostico: '',
    profesionalDiagnostico: '',
    evidenciaDiagnosticoUri: '',
    responsable: '',
    observaciones: '',
  })
  const [savingEvento, setSavingEvento] = useState(false)

  // Modal state: Tratamiento
  const [tratamientoModalOpen, setTratamientoModalOpen] = useState(false)
  const [editingTratamiento, setEditingTratamiento] = useState<Tratamiento | null>(null)
  const [tratamientoForm, setTratamientoForm] = useState<TratamientoInput>({
    idEventoSanitario: '',
    producto: '',
    dosis: 5,
    unidadDosis: 'ml',
    viaAdministracion: 'Intramuscular (IM)',
    frecuencia: 'Cada 24 horas',
    fechaInicio: toLocalDateTimeInput(),
    fechaFin: '',
    responsable: '',
    prescripcionUri: '',
    estado: 'En curso',
  })
  const [savingTratamiento, setSavingTratamiento] = useState(false)

  // Modal state: Quick Recordatorio from Tratamiento
  const [recordatorioModalOpen, setRecordatorioModalOpen] = useState(false)
  const [quickRecordatorioForm, setQuickRecordatorioForm] = useState<RecordatorioInput>(() => ({
    idAnimal: '',
    idTratamiento: '',
    tipo: 'Aplicación de tratamiento',
    descripcion: '',
    fechaProgramada: toNextDayDateTimeInput(),
    estado: 'Pendiente',
  }))
  const [savingQuickRecordatorio, setSavingQuickRecordatorio] = useState(false)

  const filteredEventos = eventos.filter((ev) => {
    if (filterAnimal && ev.idAnimal !== filterAnimal) return false
    if (filterTipo && ev.tipo !== filterTipo) return false
    if (!searchTerm.trim()) return true
    const q = searchTerm.toLowerCase()
    const matchEvento =
      ev.idAnimal.toLowerCase().includes(q) ||
      (ev.animalArete || '').toLowerCase().includes(q) ||
      (ev.animalNombre || '').toLowerCase().includes(q) ||
      ev.tipo.toLowerCase().includes(q) ||
      ev.responsable.toLowerCase().includes(q) ||
      (ev.diagnostico || '').toLowerCase().includes(q) ||
      (ev.sintomas || '').toLowerCase().includes(q) ||
      (ev.profesionalDiagnostico || '').toLowerCase().includes(q)
    const matchTratamiento = ev.tratamientos.some(
      (t) =>
        t.producto.toLowerCase().includes(q) ||
        t.responsable.toLowerCase().includes(q)
    )
    return matchEvento || matchTratamiento
  })

  const tratamientosEnCurso = tratamientos.filter((t) => t.estado === 'En curso' || t.estado === 'Programado').length
  const tratamientosCompletados = tratamientos.filter((t) => t.estado === 'Completado').length
  const animalesConEventos = new Set(eventos.map((e) => e.idAnimal)).size

  function openNewEventoModal() {
    setEditingEvento(null)
    setEventoForm({
      idAnimal: cattle[0] ? String(cattle[0].id) : '',
      tipo: 'Vacunación',
      fecha: toLocalDateTimeInput(),
      sintomas: '',
      diagnostico: '',
      profesionalDiagnostico: '',
      evidenciaDiagnosticoUri: '',
      responsable: '',
      observaciones: '',
    })
    setEventoModalOpen(true)
  }

  function openEditEventoModal(evento: EventoSanitario) {
    setEditingEvento(evento)
    setEventoForm({
      idAnimal: evento.idAnimal,
      tipo: evento.tipo,
      fecha: toLocalDateTimeInput(evento.fecha),
      sintomas: evento.sintomas || '',
      diagnostico: evento.diagnostico || '',
      profesionalDiagnostico: evento.profesionalDiagnostico || '',
      evidenciaDiagnosticoUri: evento.evidenciaDiagnosticoUri || '',
      responsable: evento.responsable,
      observaciones: evento.observaciones || '',
    })
    setEventoModalOpen(true)
  }

  async function handleSubmitEvento(e: FormEvent) {
    e.preventDefault()
    setSavingEvento(true)
    setFeedback(null)
    try {
      await saveEvento(
        {
          ...eventoForm,
          fecha: new Date(eventoForm.fecha).toISOString(),
        },
        editingEvento?.idEventoSanitario
      )
      setEventoModalOpen(false)
      setFeedback({
        type: 'success',
        message: editingEvento
          ? 'Evento sanitario actualizado correctamente.'
          : 'Evento sanitario registrado en el expediente.',
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo guardar el evento sanitario.',
      })
    } finally {
      setSavingEvento(false)
    }
  }

  async function handleDeleteEvento(evento: EventoSanitario) {
    if (!window.confirm(`¿Dar de baja el evento sanitario (${evento.tipo}) del animal ${evento.animalArete || evento.idAnimal}?`)) {
      return
    }
    try {
      await removeEvento(evento.idEventoSanitario)
      setFeedback({ type: 'success', message: 'Evento sanitario dado de baja (trazabilidad conservada).' })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo eliminar el evento sanitario.',
      })
    }
  }

  function openNewTratamientoModal(evento: EventoSanitario) {
    setEditingTratamiento(null)
    setTratamientoForm({
      idEventoSanitario: evento.idEventoSanitario,
      producto: '',
      dosis: 5,
      unidadDosis: 'ml',
      viaAdministracion: 'Intramuscular (IM)',
      frecuencia: 'Cada 24 horas',
      fechaInicio: toLocalDateTimeInput(),
      fechaFin: '',
      responsable: evento.responsable,
      prescripcionUri: '',
      estado: 'En curso',
    })
    setTratamientoModalOpen(true)
  }

  function openEditTratamientoModal(tratamiento: Tratamiento) {
    setEditingTratamiento(tratamiento)
    setTratamientoForm({
      idEventoSanitario: tratamiento.idEventoSanitario,
      producto: tratamiento.producto,
      dosis: tratamiento.dosis,
      unidadDosis: tratamiento.unidadDosis,
      viaAdministracion: tratamiento.viaAdministracion || '',
      frecuencia: tratamiento.frecuencia,
      fechaInicio: toLocalDateTimeInput(tratamiento.fechaInicio),
      fechaFin: tratamiento.fechaFin ? toLocalDateTimeInput(tratamiento.fechaFin) : '',
      responsable: tratamiento.responsable,
      prescripcionUri: tratamiento.prescripcionUri || '',
      estado: tratamiento.estado,
    })
    setTratamientoModalOpen(true)
  }

  async function handleSubmitTratamiento(e: FormEvent) {
    e.preventDefault()
    setSavingTratamiento(true)
    setFeedback(null)
    try {
      await saveTratamiento(
        {
          ...tratamientoForm,
          dosis: Number(tratamientoForm.dosis),
          fechaInicio: new Date(tratamientoForm.fechaInicio).toISOString(),
          fechaFin: tratamientoForm.fechaFin ? new Date(tratamientoForm.fechaFin).toISOString() : null,
        },
        editingTratamiento?.idTratamiento
      )
      setTratamientoModalOpen(false)
      setFeedback({
        type: 'success',
        message: editingTratamiento
          ? 'Tratamiento actualizado correctamente.'
          : 'Tratamiento agregado al evento sanitario.',
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo guardar el tratamiento.',
      })
    } finally {
      setSavingTratamiento(false)
    }
  }

  async function handleDeleteTratamiento(tratamiento: Tratamiento) {
    if (!window.confirm(`¿Dar de baja el tratamiento con "${tratamiento.producto}"?`)) return
    try {
      await removeTratamiento(tratamiento.idTratamiento)
      setFeedback({ type: 'success', message: 'Tratamiento dado de baja.' })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo eliminar el tratamiento.',
      })
    }
  }

  function openQuickRecordatorio(tratamiento: Tratamiento, evento: EventoSanitario) {
    setQuickRecordatorioForm({
      idAnimal: evento.idAnimal,
      idTratamiento: tratamiento.idTratamiento,
      idResponsable: tratamiento.responsable,
      tipo: 'Aplicación de tratamiento',
      descripcion: `Aplicar ${tratamiento.producto} (${tratamiento.dosis} ${tratamiento.unidadDosis}, ${tratamiento.frecuencia})`,
      fechaProgramada: toNextDayDateTimeInput(),
      estado: 'Pendiente',
    })
    setRecordatorioModalOpen(true)
  }

  async function handleSubmitQuickRecordatorio(e: FormEvent) {
    e.preventDefault()
    setSavingQuickRecordatorio(true)
    setFeedback(null)
    try {
      await saveRecordatorio({
        ...quickRecordatorioForm,
        fechaProgramada: new Date(quickRecordatorioForm.fechaProgramada).toISOString(),
      })
      setRecordatorioModalOpen(false)
      setFeedback({
        type: 'success',
        message: 'Recordatorio programado en la agenda sanitaria.',
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo programar el recordatorio.',
      })
    } finally {
      setSavingQuickRecordatorio(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Encabezado */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-brand-primary text-xs font-bold uppercase tracking-wider mb-1">
            <Syringe size={14} /> Módulo 3 · Sanidad y Agenda (MVP v0.1.0)
          </div>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed">
            Salud y Tratamientos
          </h1>
          <p className="text-brand-slate/70 text-[15px] mt-1">
            Bitácora de eventos sanitarios (`EventoSanitario`) y esquemas terapéuticos (`Tratamiento`) por animal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onNavigateToAgenda && (
            <button
              type="button"
              onClick={onNavigateToAgenda}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-brand-slate font-semibold text-[14px] transition-colors shadow-xs"
            >
              <Calendar size={17} className="text-brand-primary" />
              Ver Agenda y Recordatorios
            </button>
          )}
          <button
            type="button"
            onClick={openNewEventoModal}
            className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 py-2.5 rounded-lg font-semibold text-[14px] transition-colors shadow-sm"
          >
            <Plus size={18} />
            Registrar Evento Sanitario
          </button>
        </div>
      </header>

      {/* Regla 11 del Modelo ER */}
      <div className="bg-surface-secondary/70 border border-brand-primary/20 rounded-lg p-3.5 flex items-start gap-3 text-[13px] text-brand-slate">
        <ShieldAlert size={18} className="text-brand-primary shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold text-brand-forest">Regla 11 de Integridad Sanitaria:</strong>{' '}
          Sanidad conserva siempre al responsable del evento y, cuando exista, al profesional del diagnóstico y su evidencia documental.{' '}
          <span className="underline decoration-brand-primary/40">La aplicación no diagnostica ni prescribe por cuenta propia.</span>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-lg border flex items-center justify-between text-[14px] ${
            feedback.type === 'success'
              ? 'bg-status-success/10 border-status-success/30 text-status-success'
              : 'bg-status-error/10 border-status-error/30 text-status-error'
          }`}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg border bg-status-error/10 border-status-error/30 text-status-error text-[14px]">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[12px] font-bold uppercase text-brand-slate/60">Eventos Sanitarios</span>
            <Stethoscope size={18} className="text-brand-primary" />
          </div>
          <p className="text-3xl font-bold font-condensed text-brand-forest">{eventos.length}</p>
          <p className="text-[12px] text-brand-slate/60 mt-1">Registros clínicos en bitácora</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[12px] font-bold uppercase text-brand-slate/60">Tratamientos Activos</span>
            <Clock size={18} className="text-status-warning" />
          </div>
          <p className="text-3xl font-bold font-condensed text-brand-forest">{tratamientosEnCurso}</p>
          <p className="text-[12px] text-brand-slate/60 mt-1">En curso o programados</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[12px] font-bold uppercase text-brand-slate/60">Tratamientos Concluidos</span>
            <CheckCircle2 size={18} className="text-status-success" />
          </div>
          <p className="text-3xl font-bold font-condensed text-brand-forest">{tratamientosCompletados}</p>
          <p className="text-[12px] text-brand-slate/60 mt-1">Esquemas finalizados</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[12px] font-bold uppercase text-brand-slate/60">Bovinos con Historial</span>
            <Beef size={18} className="text-brand-primary" />
          </div>
          <p className="text-3xl font-bold font-condensed text-brand-forest">{animalesConEventos}</p>
          <p className="text-[12px] text-brand-slate/60 mt-1">De {cattle.length} bovinos registrados</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por arete, diagnóstico, síntomas, medicamento o responsable..."
            className="w-full pl-10 pr-4 py-2 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:outline-none focus:border-brand-primary"
          />
        </div>

        <select
          value={filterAnimal}
          onChange={(e) => setFilterAnimal(e.target.value)}
          className="px-3 py-2 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:outline-none focus:border-brand-primary"
        >
          <option value="">Todos los bovinos</option>
          {cattle.map((b) => (
            <option key={b.id} value={String(b.id)}>
              Arete {b.earTag} {b.name ? `— ${b.name}` : ''}
            </option>
          ))}
        </select>

        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="px-3 py-2 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:outline-none focus:border-brand-primary"
        >
          <option value="">Todos los tipos de evento</option>
          {TIPOS_EVENTO_SANITARIO.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </select>
      </div>

      {/* Listado de Eventos Sanitarios y sus Tratamientos */}
      {loading ? (
        <div className="bg-surface-white border border-border-light rounded-lg p-12 text-center text-brand-slate/60">
          Cargando historial sanitario...
        </div>
      ) : filteredEventos.length === 0 ? (
        <div className="bg-surface-white border border-border-light rounded-lg p-12 text-center space-y-3">
          <Stethoscope size={36} className="mx-auto text-brand-slate/30" />
          <h3 className="text-lg font-bold text-brand-slate">Sin eventos sanitarios registrados</h3>
          <p className="text-[14px] text-brand-slate/60 max-w-md mx-auto">
            Registra vacunaciones, desparasitaciones, revisiones clínicas o enfermedades y asocia sus tratamientos con dosis y responsable.
          </p>
          <button
            type="button"
            onClick={openNewEventoModal}
            className="inline-flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 py-2 rounded-lg font-semibold text-[14px] transition-colors"
          >
            <Plus size={16} /> Registrar primer evento sanitario
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEventos.map((evento) => (
            <div
              key={evento.idEventoSanitario}
              className="bg-surface-white border border-border-light rounded-lg shadow-xs overflow-hidden"
            >
              {/* Cabecera del EventoSanitario */}
              <div className="p-5 border-b border-border-light flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-surface-app/40">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-primary text-white">
                      {evento.tipo}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-surface-secondary text-brand-forest border border-brand-primary/20">
                      Arete: {evento.animalArete || `ID #${evento.idAnimal}`}
                      {evento.animalNombre ? ` (${evento.animalNombre})` : ''}
                    </span>
                    <span className="text-xs text-brand-slate/60 flex items-center gap-1">
                      <Calendar size={13} />
                      {new Date(evento.fecha).toLocaleString('es-MX', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span className="text-[11px] text-brand-slate/40 font-mono">
                      v{evento.versionRegistro} · {evento.idEventoSanitario.slice(0, 8)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-brand-slate/80">
                    <span className="flex items-center gap-1.5">
                      <UserCheck size={14} className="text-brand-primary" />
                      <strong>Responsable:</strong> {evento.responsable}
                    </span>
                    {evento.profesionalDiagnostico && (
                      <span className="flex items-center gap-1.5">
                        <Stethoscope size={14} className="text-brand-primary" />
                        <strong>Profesional diagnóstico:</strong> {evento.profesionalDiagnostico}
                      </span>
                    )}
                    {evento.evidenciaDiagnosticoUri && (
                      <a
                        href={evento.evidenciaDiagnosticoUri}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-brand-primary hover:underline font-medium"
                      >
                        Evidencia diagnóstica <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openNewTratamientoModal(evento)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary font-semibold text-xs transition-colors"
                  >
                    <Pill size={14} /> + Agregar Tratamiento
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditEventoModal(evento)}
                    className="p-1.5 text-brand-slate/60 hover:text-brand-primary hover:bg-surface-secondary rounded-md transition-colors"
                    title="Editar evento sanitario"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteEvento(evento)}
                    className="p-1.5 text-status-error/70 hover:text-status-error hover:bg-status-error/10 rounded-md transition-colors"
                    title="Dar de baja evento sanitario"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Cuerpo Clínico del EventoSanitario */}
              {(evento.sintomas || evento.diagnostico || evento.observaciones) && (
                <div className="px-5 py-3.5 grid grid-cols-1 md:grid-cols-3 gap-4 text-[13px] border-b border-border-light bg-surface-white">
                  {evento.sintomas && (
                    <div>
                      <span className="block text-[11px] font-bold uppercase text-brand-slate/50">
                        Síntomas observados
                      </span>
                      <p className="text-brand-slate mt-0.5">{evento.sintomas}</p>
                    </div>
                  )}
                  {evento.diagnostico && (
                    <div>
                      <span className="block text-[11px] font-bold uppercase text-brand-slate/50">
                        Diagnóstico registrado
                      </span>
                      <p className="text-brand-slate mt-0.5">{evento.diagnostico}</p>
                    </div>
                  )}
                  {evento.observaciones && (
                    <div>
                      <span className="block text-[11px] font-bold uppercase text-brand-slate/50">
                        Observaciones
                      </span>
                      <p className="text-brand-slate mt-0.5">{evento.observaciones}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Lista de Tratamientos asociados a este EventoSanitario */}
              <div className="p-5 bg-surface-white">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-brand-slate/60 flex items-center gap-1.5">
                    <Pill size={14} className="text-brand-primary" />
                    Tratamientos Prescritos / Aplicados ({evento.tratamientos.length})
                  </h4>
                </div>

                {evento.tratamientos.length === 0 ? (
                  <p className="text-[13px] text-brand-slate/50 italic">
                    No se han registrado medicamentos ni tratamientos para este evento sanitario.
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-border-light rounded-lg">
                    <table className="w-full text-left text-[13px]">
                      <thead className="bg-surface-app text-brand-slate/70 font-semibold border-b border-border-light">
                        <tr>
                          <th className="px-3.5 py-2.5">Producto</th>
                          <th className="px-3.5 py-2.5">Dosis / Vía</th>
                          <th className="px-3.5 py-2.5">Frecuencia</th>
                          <th className="px-3.5 py-2.5">Periodo</th>
                          <th className="px-3.5 py-2.5">Responsable</th>
                          <th className="px-3.5 py-2.5">Estado</th>
                          <th className="px-3.5 py-2.5 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-light">
                        {evento.tratamientos.map((trat) => (
                          <tr key={trat.idTratamiento} className="hover:bg-surface-app/50">
                            <td className="px-3.5 py-2.5 font-semibold text-brand-forest">
                              <div>{trat.producto}</div>
                              {trat.prescripcionUri && (
                                <a
                                  href={trat.prescripcionUri}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-normal text-brand-primary hover:underline"
                                >
                                  Ver receta <ExternalLink size={10} />
                                </a>
                              )}
                            </td>
                            <td className="px-3.5 py-2.5">
                              <span className="font-semibold">
                                {trat.dosis} {trat.unidadDosis}
                              </span>
                              {trat.viaAdministracion && (
                                <span className="block text-[11px] text-brand-slate/60">
                                  {trat.viaAdministracion}
                                </span>
                              )}
                            </td>
                            <td className="px-3.5 py-2.5">{trat.frecuencia}</td>
                            <td className="px-3.5 py-2.5 text-xs text-brand-slate/70">
                              <div>Inicio: {new Date(trat.fechaInicio).toLocaleDateString('es-MX')}</div>
                              {trat.fechaFin && (
                                <div>Fin: {new Date(trat.fechaFin).toLocaleDateString('es-MX')}</div>
                              )}
                            </td>
                            <td className="px-3.5 py-2.5">{trat.responsable}</td>
                            <td className="px-3.5 py-2.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  trat.estado === 'Completado'
                                    ? 'bg-status-success/15 text-status-success'
                                    : trat.estado === 'Suspendido'
                                      ? 'bg-status-error/15 text-status-error'
                                      : 'bg-status-warning/15 text-status-warning'
                                }`}
                              >
                                {trat.estado}
                              </span>
                            </td>
                            <td className="px-3.5 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openQuickRecordatorio(trat, evento)}
                                  className="px-2 py-1 rounded bg-surface-secondary hover:bg-brand-primary hover:text-white text-brand-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                                  title="Agendar recordatorio para este tratamiento"
                                >
                                  <BellPlus size={13} /> Agendar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditTratamientoModal(trat)}
                                  className="p-1 text-brand-slate/60 hover:text-brand-primary rounded"
                                  title="Editar tratamiento"
                                >
                                  <Edit size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTratamiento(trat)}
                                  className="p-1 text-status-error/70 hover:text-status-error rounded"
                                  title="Dar de baja tratamiento"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Crear / Editar EventoSanitario */}
      {eventoModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-white rounded-xl shadow-xl w-full max-w-2xl border border-border-light overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light bg-surface-app">
              <div>
                <h2 className="text-xl font-bold font-condensed text-brand-forest">
                  {editingEvento ? 'Editar Evento Sanitario' : 'Nuevo Evento Sanitario'}
                </h2>
                <p className="text-xs text-brand-slate/60">
                  Entidad `EventoSanitario` · Conserva responsable y profesional del diagnóstico (Regla 11)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEventoModalOpen(false)}
                className="text-brand-slate/50 hover:text-brand-slate"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmitEvento} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Animal (`idAnimal`) *
                  </label>
                  {cattle.length > 0 ? (
                    <select
                      required
                      value={eventoForm.idAnimal}
                      onChange={(e) => setEventoForm({ ...eventoForm, idAnimal: e.target.value })}
                      className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white focus:outline-none focus:border-brand-primary"
                    >
                      <option value="">Selecciona un bovino...</option>
                      {cattle.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          Arete {b.earTag} {b.name ? `— ${b.name}` : ''} ({b.breed})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      maxLength={36}
                      placeholder="Arete o UUID del animal (ej. BOV-001)"
                      value={eventoForm.idAnimal}
                      onChange={(e) => setEventoForm({ ...eventoForm, idAnimal: e.target.value })}
                      className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Tipo de Evento (`tipo`) *
                  </label>
                  <select
                    required
                    value={eventoForm.tipo}
                    onChange={(e) => setEventoForm({ ...eventoForm, tipo: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white focus:outline-none focus:border-brand-primary"
                  >
                    {TIPOS_EVENTO_SANITARIO.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Fecha y Hora (`fecha`) *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={eventoForm.fecha}
                    onChange={(e) => setEventoForm({ ...eventoForm, fecha: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Responsable en Rancho (`responsable`) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={180}
                    placeholder="Nombre del encargado o vaquero responsable"
                    value={eventoForm.responsable}
                    onChange={(e) => setEventoForm({ ...eventoForm, responsable: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Profesional del Diagnóstico (`profesionalDiagnostico`)
                  </label>
                  <input
                    type="text"
                    maxLength={180}
                    placeholder="MVZ / Médico Veterinario (opcional)"
                    value={eventoForm.profesionalDiagnostico || ''}
                    onChange={(e) =>
                      setEventoForm({ ...eventoForm, profesionalDiagnostico: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    URI Evidencia Diagnóstica (`evidenciaDiagnosticoURI`)
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="https://... o referencia de laboratorio (opcional)"
                    value={eventoForm.evidenciaDiagnosticoUri || ''}
                    onChange={(e) =>
                      setEventoForm({ ...eventoForm, evidenciaDiagnosticoUri: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Síntomas (`sintomas`)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Signos clínicos observados..."
                    value={eventoForm.sintomas || ''}
                    onChange={(e) => setEventoForm({ ...eventoForm, sintomas: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Diagnóstico (`diagnostico`)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Diagnóstico emitido por el profesional..."
                    value={eventoForm.diagnostico || ''}
                    onChange={(e) => setEventoForm({ ...eventoForm, diagnostico: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                  Observaciones adicionales (`observaciones`)
                </label>
                <textarea
                  rows={2}
                  placeholder="Lote de vacuna, condiciones de manejo, notas de seguimiento..."
                  value={eventoForm.observaciones || ''}
                  onChange={(e) => setEventoForm({ ...eventoForm, observaciones: e.target.value })}
                  className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setEventoModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-border-light text-brand-slate text-[14px] font-medium hover:bg-surface-app"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEvento}
                  className="px-5 py-2 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[14px] font-semibold disabled:opacity-50"
                >
                  {savingEvento ? 'Guardando...' : editingEvento ? 'Guardar Cambios' : 'Registrar Evento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Crear / Editar Tratamiento */}
      {tratamientoModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-white rounded-xl shadow-xl w-full max-w-xl border border-border-light overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light bg-surface-app">
              <div>
                <h2 className="text-xl font-bold font-condensed text-brand-forest">
                  {editingTratamiento ? 'Editar Tratamiento' : 'Agregar Tratamiento al Evento'}
                </h2>
                <p className="text-xs text-brand-slate/60">
                  Entidad `Tratamiento` · Vinculada por `idEventoSanitario`
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTratamientoModalOpen(false)}
                className="text-brand-slate/50 hover:text-brand-slate"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmitTratamiento} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Producto / Medicamento (`producto`) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={150}
                    placeholder="Ej. Ivermectina 1%, Bacterina Triple, Oxitetraciclina..."
                    value={tratamientoForm.producto}
                    onChange={(e) => setTratamientoForm({ ...tratamientoForm, producto: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Dosis (`dosis` &gt; 0) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.001"
                    step="0.001"
                    value={tratamientoForm.dosis}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, dosis: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Unidad de Dosis (`unidadDosis`) *
                  </label>
                  <select
                    required
                    value={tratamientoForm.unidadDosis}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, unidadDosis: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white focus:outline-none focus:border-brand-primary"
                  >
                    {UNIDADES_DOSIS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Vía de Administración (`viaAdministracion`)
                  </label>
                  <select
                    value={tratamientoForm.viaAdministracion || ''}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, viaAdministracion: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white focus:outline-none focus:border-brand-primary"
                  >
                    <option value="">Sin especificar</option>
                    {VIAS_ADMINISTRACION.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Frecuencia (`frecuencia`) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    placeholder="Ej. Dosis única, Cada 24 horas por 3 días..."
                    value={tratamientoForm.frecuencia}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, frecuencia: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Fecha de Inicio (`fechaInicio`) *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={tratamientoForm.fechaInicio}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, fechaInicio: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Fecha de Fin (`fechaFin`)
                  </label>
                  <input
                    type="datetime-local"
                    value={tratamientoForm.fechaFin || ''}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, fechaFin: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Responsable (`responsable`) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={180}
                    placeholder="Quien administra el tratamiento"
                    value={tratamientoForm.responsable}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, responsable: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Estado (`estado`) *
                  </label>
                  <select
                    required
                    value={tratamientoForm.estado}
                    onChange={(e) => setTratamientoForm({ ...tratamientoForm, estado: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white focus:outline-none focus:border-brand-primary"
                  >
                    {ESTADOS_TRATAMIENTO.map((est) => (
                      <option key={est} value={est}>
                        {est}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    URI de Prescripción / Receta (`prescripcionURI`)
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="https://... o folio de receta médica (opcional)"
                    value={tratamientoForm.prescripcionUri || ''}
                    onChange={(e) =>
                      setTratamientoForm({ ...tratamientoForm, prescripcionUri: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setTratamientoModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-border-light text-brand-slate text-[14px] font-medium hover:bg-surface-app"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingTratamiento}
                  className="px-5 py-2 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[14px] font-semibold disabled:opacity-50"
                >
                  {savingTratamiento ? 'Guardando...' : editingTratamiento ? 'Actualizar' : 'Guardar Tratamiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Rápido: Agendar Recordatorio desde Tratamiento */}
      {recordatorioModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-white rounded-xl shadow-xl w-full max-w-lg border border-border-light overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light bg-surface-app">
              <div>
                <h2 className="text-xl font-bold font-condensed text-brand-forest">
                  Programar Recordatorio de Tratamiento
                </h2>
                <p className="text-xs text-brand-slate/60">
                  Vincula automáticamente `idTratamiento` y `idAnimal` (Regla 12)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecordatorioModalOpen(false)}
                className="text-brand-slate/50 hover:text-brand-slate"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmitQuickRecordatorio} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                  Tipo de Recordatorio (`tipo`) *
                </label>
                <select
                  required
                  value={quickRecordatorioForm.tipo}
                  onChange={(e) =>
                    setQuickRecordatorioForm({ ...quickRecordatorioForm, tipo: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white"
                >
                  {TIPOS_RECORDATORIO.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                  Descripción (`descripcion`) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={250}
                  value={quickRecordatorioForm.descripcion}
                  onChange={(e) =>
                    setQuickRecordatorioForm({ ...quickRecordatorioForm, descripcion: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-border-light rounded-md text-[14px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Fecha Programada (`fechaProgramada`) *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={quickRecordatorioForm.fechaProgramada}
                    onChange={(e) =>
                      setQuickRecordatorioForm({
                        ...quickRecordatorioForm,
                        fechaProgramada: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Responsable (`idResponsable`)
                  </label>
                  <input
                    type="text"
                    maxLength={36}
                    value={quickRecordatorioForm.idResponsable || ''}
                    onChange={(e) =>
                      setQuickRecordatorioForm({
                        ...quickRecordatorioForm,
                        idResponsable: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setRecordatorioModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-border-light text-brand-slate text-[14px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingQuickRecordatorio}
                  className="px-5 py-2 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[14px] font-semibold"
                >
                  {savingQuickRecordatorio ? 'Agendando...' : 'Guardar en Agenda'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default SanidadPage
