import { useState, type FormEvent } from 'react'
import {
  Bell,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  Edit,
  Trash2,
  X,
  RotateCcw,
  Syringe,
  MapPin,
  Beef,
  Layers,
  Info,
} from 'lucide-react'
import { useCattle } from '../../hooks/useCattle'
import { useSanidad } from '../../hooks/useSanidad'
import {
  ESTADOS_RECORDATORIO,
  TIPOS_RECORDATORIO,
  type Recordatorio,
  type RecordatorioInput,
} from '../../types/sanidad'

interface AgendaPageProps {
  onNavigateToSanidad?: () => void
}

type AmbitoRecordatorio = 'rancho' | 'animal' | 'lote'

function toLocalDateTimeInput(iso?: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 86_400_000)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function AgendaPage({ onNavigateToSanidad }: AgendaPageProps) {
  const { cattle } = useCattle()
  const {
    recordatorios,
    tratamientos,
    loading,
    error,
    saveRecordatorio,
    cambiarEstadoRecordatorio,
    removeRecordatorio,
  } = useSanidad()

  const [tab, setTab] = useState<'todos' | 'pendientes' | 'vencidos' | 'completados'>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecordatorio, setEditingRecordatorio] = useState<Recordatorio | null>(null)
  const [ambito, setAmbito] = useState<AmbitoRecordatorio>('animal')
  const [form, setForm] = useState<RecordatorioInput>({
    idRancho: '00000000-0000-0000-0000-000000000100',
    idAnimal: '',
    idLote: '',
    idTratamiento: '',
    idResponsable: '',
    tipo: 'Aplicación de tratamiento',
    descripcion: '',
    fechaProgramada: toLocalDateTimeInput(),
    estado: 'Pendiente',
  })
  const [saving, setSaving] = useState(false)

  const now = new Date()

  const isVencido = (r: Recordatorio) =>
    r.estado === 'Pendiente' && new Date(r.fechaProgramada) < now

  const pendientesCount = recordatorios.filter((r) => r.estado === 'Pendiente').length
  const vencidosCount = recordatorios.filter(isVencido).length
  const completadosCount = recordatorios.filter((r) => r.estado === 'Completado').length

  const filteredRecordatorios = recordatorios.filter((r) => {
    if (tab === 'pendientes' && r.estado !== 'Pendiente') return false
    if (tab === 'vencidos' && !isVencido(r)) return false
    if (tab === 'completados' && r.estado !== 'Completado') return false
    if (!searchTerm.trim()) return true
    const q = searchTerm.toLowerCase()
    return (
      r.descripcion.toLowerCase().includes(q) ||
      r.tipo.toLowerCase().includes(q) ||
      (r.animalArete || '').toLowerCase().includes(q) ||
      (r.animalNombre || '').toLowerCase().includes(q) ||
      (r.idAnimal || '').toLowerCase().includes(q) ||
      (r.idLote || '').toLowerCase().includes(q) ||
      (r.tratamientoProducto || '').toLowerCase().includes(q) ||
      (r.idResponsable || '').toLowerCase().includes(q)
    )
  })

  // Tratamientos que corresponden al animal seleccionado (Regla 12)
  const tratamientosDelAnimal = form.idAnimal
    ? tratamientos.filter((t) => t.idAnimal === form.idAnimal)
    : tratamientos

  function openNewModal() {
    setEditingRecordatorio(null)
    const defaultAnimal = cattle[0] ? String(cattle[0].id) : ''
    setAmbito(defaultAnimal ? 'animal' : 'rancho')
    setForm({
      idRancho: '00000000-0000-0000-0000-000000000100',
      idAnimal: defaultAnimal,
      idLote: '',
      idTratamiento: '',
      idResponsable: '',
      tipo: 'Aplicación de tratamiento',
      descripcion: '',
      fechaProgramada: toLocalDateTimeInput(),
      estado: 'Pendiente',
    })
    setModalOpen(true)
  }

  function openEditModal(r: Recordatorio) {
    setEditingRecordatorio(r)
    const detectedAmbito: AmbitoRecordatorio = r.idAnimal
      ? 'animal'
      : r.idLote
        ? 'lote'
        : 'rancho'
    setAmbito(detectedAmbito)
    setForm({
      idRancho: r.idRancho,
      idAnimal: r.idAnimal || '',
      idLote: r.idLote || '',
      idTratamiento: r.idTratamiento || '',
      idResponsable: r.idResponsable || '',
      tipo: r.tipo,
      descripcion: r.descripcion,
      fechaProgramada: toLocalDateTimeInput(r.fechaProgramada),
      estado: r.estado,
      fechaCompletado: r.fechaCompletado,
    })
    setModalOpen(true)
  }

  function handleAmbitoChange(nextAmbito: AmbitoRecordatorio) {
    setAmbito(nextAmbito)
    // Regla 12: animal y lote son excluyentes; el tratamiento solo aplica a un animal.
    if (nextAmbito === 'rancho') {
      setForm((prev) => ({ ...prev, idAnimal: '', idLote: '', idTratamiento: '' }))
    } else if (nextAmbito === 'animal') {
      setForm((prev) => ({
        ...prev,
        idAnimal: prev.idAnimal || (cattle[0] ? String(cattle[0].id) : ''),
        idLote: '',
      }))
    } else {
      setForm((prev) => ({ ...prev, idAnimal: '', idTratamiento: '', idLote: prev.idLote || 'LOTE-NORTE-01' }))
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFeedback(null)
    try {
      const payload: RecordatorioInput = {
        ...form,
        idAnimal: ambito === 'animal' ? form.idAnimal || null : null,
        idLote: ambito === 'lote' ? form.idLote || null : null,
        idTratamiento: ambito === 'animal' ? form.idTratamiento || null : null,
        idResponsable: form.idResponsable || null,
        fechaProgramada: new Date(form.fechaProgramada).toISOString(),
      }
      await saveRecordatorio(payload, editingRecordatorio?.idRecordatorio)
      setModalOpen(false)
      setFeedback({
        type: 'success',
        message: editingRecordatorio
          ? 'Recordatorio actualizado correctamente.'
          : 'Recordatorio programado en la agenda.',
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo guardar el recordatorio.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleCompletado(r: Recordatorio) {
    const nuevoEstado = r.estado === 'Completado' ? 'Pendiente' : 'Completado'
    try {
      await cambiarEstadoRecordatorio(r.idRecordatorio, nuevoEstado)
      setFeedback({
        type: 'success',
        message:
          nuevoEstado === 'Completado'
            ? 'Recordatorio marcado como completado (Regla 13: su registro sanitario se conserva intacto).'
            : 'Recordatorio reabierto como pendiente.',
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo cambiar el estado del recordatorio.',
      })
    }
  }

  async function handleDelete(r: Recordatorio) {
    if (!window.confirm(`¿Dar de baja el recordatorio "${r.descripcion}"?`)) return
    try {
      await removeRecordatorio(r.idRecordatorio)
      setFeedback({ type: 'success', message: 'Recordatorio dado de baja.' })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo eliminar el recordatorio.',
      })
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Encabezado */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-brand-primary text-xs font-bold uppercase tracking-wider mb-1">
            <Bell size={14} /> Módulo 3 · Sanidad y Agenda (MVP v0.1.0)
          </div>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed">
            Agenda y Alertas Sanitarias
          </h1>
          <p className="text-brand-slate/70 text-[15px] mt-1">
            Programación de recordatorios (`Recordatorio`) generales del rancho, individuales por animal o por lote.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onNavigateToSanidad && (
            <button
              type="button"
              onClick={onNavigateToSanidad}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-brand-slate font-semibold text-[14px] transition-colors shadow-xs"
            >
              <Syringe size={17} className="text-brand-primary" />
              Ir a Salud y Tratamientos
            </button>
          )}
          <button
            type="button"
            onClick={openNewModal}
            className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 py-2.5 rounded-lg font-semibold text-[14px] transition-colors shadow-sm"
          >
            <Plus size={18} />
            Nuevo Recordatorio
          </button>
        </div>
      </header>

      {/* Reglas 12 y 13 del Modelo ER */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-surface-secondary/70 border border-brand-primary/20 rounded-lg p-3.5 flex items-start gap-3 text-[13px] text-brand-slate">
          <Info size={18} className="text-brand-primary shrink-0 mt-0.5" />
          <div>
            <strong className="font-semibold text-brand-forest">Regla 12 (Ámbito Excluyente):</strong>{' '}
            Un recordatorio puede ser general del rancho, individual (`idAnimal`) o por lote (`idLote`); animal y lote son excluyentes. El tratamiento debe corresponder al animal.
          </div>
        </div>

        <div className="bg-surface-secondary/70 border border-brand-primary/20 rounded-lg p-3.5 flex items-start gap-3 text-[13px] text-brand-slate">
          <CheckCircle2 size={18} className="text-brand-primary shrink-0 mt-0.5" />
          <div>
            <strong className="font-semibold text-brand-forest">Regla 13 (Trazabilidad):</strong>{' '}
            Marcar un recordatorio como completado no demuestra por sí mismo que se haya aplicado el tratamiento; se conserva intacto su registro sanitario.
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border flex items-center justify-between text-[14px] ${
            feedback.type === 'success'
              ? 'bg-status-success/10 border-status-success/30 text-status-success'
              : 'bg-status-error/10 border-status-error/30 text-status-error'
          }`}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)}>
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
            <span className="text-[12px] font-bold uppercase text-brand-slate/60">Pendientes</span>
            <Clock size={18} className="text-status-warning" />
          </div>
          <p className="text-3xl font-bold font-condensed text-brand-forest">{pendientesCount}</p>
          <p className="text-[12px] text-brand-slate/60 mt-1">Por atender en agenda</p>
        </div>

        <div className="bg-surface-white border border-status-error/30 rounded-lg p-4 shadow-xs bg-status-error/5">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[12px] font-bold uppercase text-status-error">Vencidos / Urgentes</span>
            <AlertTriangle size={18} className="text-status-error" />
          </div>
          <p className="text-3xl font-bold font-condensed text-status-error">{vencidosCount}</p>
          <p className="text-[12px] text-brand-slate/70 mt-1">Fecha programada superada</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[12px] font-bold uppercase text-brand-slate/60">Completados</span>
            <CheckCircle2 size={18} className="text-status-success" />
          </div>
          <p className="text-3xl font-bold font-condensed text-brand-forest">{completadosCount}</p>
          <p className="text-[12px] text-brand-slate/60 mt-1">Atendidos con fecha registrada</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[12px] font-bold uppercase text-brand-slate/60">Total en Agenda</span>
            <Calendar size={18} className="text-brand-primary" />
          </div>
          <p className="text-3xl font-bold font-condensed text-brand-forest">{recordatorios.length}</p>
          <p className="text-[12px] text-brand-slate/60 mt-1">Rancho El Porvenir</p>
        </div>
      </div>

      {/* Pestañas y Búsqueda */}
      <div className="bg-surface-white border border-border-light rounded-lg p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'todos', label: `Todos (${recordatorios.length})` },
              { id: 'pendientes', label: `Pendientes (${pendientesCount})` },
              { id: 'vencidos', label: `Vencidos (${vencidosCount})` },
              { id: 'completados', label: `Completados (${completadosCount})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                tab === item.id
                  ? 'bg-brand-primary text-white'
                  : 'bg-surface-app text-brand-slate hover:bg-surface-secondary'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-md">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por descripción, tipo, arete, lote o tratamiento..."
            className="w-full pl-9 pr-4 py-1.5 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:outline-none focus:border-brand-primary"
          />
        </div>
      </div>

      {/* Lista de Recordatorios */}
      {loading ? (
        <div className="bg-surface-white border border-border-light rounded-lg p-12 text-center text-brand-slate/60">
          Cargando agenda de recordatorios...
        </div>
      ) : filteredRecordatorios.length === 0 ? (
        <div className="bg-surface-white border border-border-light rounded-lg p-12 text-center space-y-3">
          <Bell size={36} className="mx-auto text-brand-slate/30" />
          <h3 className="text-lg font-bold text-brand-slate">No hay recordatorios en esta vista</h3>
          <p className="text-[14px] text-brand-slate/60 max-w-md mx-auto">
            Programa recordatorios generales para el rancho, por lote o individuales para un animal y sus tratamientos.
          </p>
          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 py-2 rounded-lg font-semibold text-[14px]"
          >
            <Plus size={16} /> Programar recordatorio
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRecordatorios.map((r) => {
            const vencido = isVencido(r)
            const completado = r.estado === 'Completado'
            return (
              <div
                key={r.idRecordatorio}
                className={`bg-surface-white border rounded-lg p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                  vencido
                    ? 'border-status-error/50 bg-status-error/5'
                    : completado
                      ? 'border-border-light opacity-80'
                      : 'border-border-light'
                }`}
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        completado
                          ? 'bg-status-success/15 text-status-success'
                          : vencido
                            ? 'bg-status-error text-white'
                            : 'bg-status-warning/15 text-status-warning'
                      }`}
                    >
                      {vencido ? 'Vencido · Pendiente' : r.estado}
                    </span>

                    <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-brand-primary/10 text-brand-primary">
                      {r.tipo}
                    </span>

                    {/* Ámbito del recordatorio (Regla 12) */}
                    {r.idAnimal ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-surface-secondary text-brand-forest border border-brand-primary/20">
                        <Beef size={12} />
                        Animal: {r.animalArete || `#${r.idAnimal}`}
                        {r.animalNombre ? ` (${r.animalNombre})` : ''}
                      </span>
                    ) : r.idLote ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                        <Layers size={12} />
                        Lote: {r.idLote}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
                        <MapPin size={12} />
                        General del Rancho
                      </span>
                    )}

                    {r.tratamientoProducto && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <Syringe size={12} />
                        Tratamiento: {r.tratamientoProducto}
                      </span>
                    )}
                  </div>

                  <p
                    className={`text-[15px] font-semibold ${
                      completado ? 'line-through text-brand-slate/60' : 'text-brand-slate'
                    }`}
                  >
                    {r.descripcion}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-slate/60">
                    <span className="flex items-center gap-1">
                      <Calendar size={13} />
                      <strong>Programado:</strong>{' '}
                      {new Date(r.fechaProgramada).toLocaleString('es-MX', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    {r.idResponsable && (
                      <span>
                        <strong>Responsable:</strong> {r.idResponsable}
                      </span>
                    )}
                    {r.fechaCompletado && (
                      <span className="text-status-success font-medium">
                        <strong>Completado:</strong>{' '}
                        {new Date(r.fechaCompletado).toLocaleString('es-MX', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    )}
                    <span className="text-[11px] text-brand-slate/40 font-mono">
                      v{r.versionRegistro} · {r.idRecordatorio.slice(0, 8)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleCompletado(r)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      completado
                        ? 'bg-surface-app hover:bg-surface-secondary text-brand-slate border border-border-light'
                        : 'bg-status-success hover:bg-green-700 text-white shadow-xs'
                    }`}
                  >
                    {completado ? (
                      <>
                        <RotateCcw size={14} /> Reabrir
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} /> Completar
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => openEditModal(r)}
                    className="p-1.5 text-brand-slate/60 hover:text-brand-primary hover:bg-surface-secondary rounded-md"
                    title="Editar recordatorio"
                  >
                    <Edit size={16} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(r)}
                    className="p-1.5 text-status-error/70 hover:text-status-error hover:bg-status-error/10 rounded-md"
                    title="Eliminar recordatorio"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: Nuevo / Editar Recordatorio */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-white rounded-xl shadow-xl w-full max-w-xl border border-border-light overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light bg-surface-app">
              <div>
                <h2 className="text-xl font-bold font-condensed text-brand-forest">
                  {editingRecordatorio ? 'Editar Recordatorio' : 'Nuevo Recordatorio Sanitario'}
                </h2>
                <p className="text-xs text-brand-slate/60">
                  Entidad `Recordatorio` · Regla 12: General del rancho, Individual por animal o Por lote
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-brand-slate/50 hover:text-brand-slate"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Selector de Ámbito Excluyente (Regla 12) */}
              <div>
                <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1.5">
                  Ámbito del Recordatorio (Regla 12: Animal y Lote son excluyentes) *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleAmbitoChange('animal')}
                    className={`py-2 px-3 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      ambito === 'animal'
                        ? 'bg-brand-primary text-white border-brand-primary'
                        : 'bg-surface-app text-brand-slate border-border-light hover:bg-surface-secondary'
                    }`}
                  >
                    <Beef size={14} /> Individual (Animal)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAmbitoChange('lote')}
                    className={`py-2 px-3 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      ambito === 'lote'
                        ? 'bg-brand-primary text-white border-brand-primary'
                        : 'bg-surface-app text-brand-slate border-border-light hover:bg-surface-secondary'
                    }`}
                  >
                    <Layers size={14} /> Por Lote
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAmbitoChange('rancho')}
                    className={`py-2 px-3 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      ambito === 'rancho'
                        ? 'bg-brand-primary text-white border-brand-primary'
                        : 'bg-surface-app text-brand-slate border-border-light hover:bg-surface-secondary'
                    }`}
                  >
                    <MapPin size={14} /> General del Rancho
                  </button>
                </div>
              </div>

              {ambito === 'animal' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-lg bg-surface-app border border-border-light">
                  <div>
                    <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                      Bovino (`idAnimal`) *
                    </label>
                    {cattle.length > 0 ? (
                      <select
                        required
                        value={form.idAnimal || ''}
                        onChange={(e) =>
                          setForm({ ...form, idAnimal: e.target.value, idTratamiento: '' })
                        }
                        className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white"
                      >
                        <option value="">Selecciona un animal...</option>
                        {cattle.map((b) => (
                          <option key={b.id} value={String(b.id)}>
                            Arete {b.earTag} {b.name ? `— ${b.name}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        required
                        maxLength={36}
                        placeholder="Arete o UUID del animal"
                        value={form.idAnimal || ''}
                        onChange={(e) => setForm({ ...form, idAnimal: e.target.value })}
                        className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                      Tratamiento Asociado (`idTratamiento`)
                    </label>
                    <select
                      value={form.idTratamiento || ''}
                      onChange={(e) => setForm({ ...form, idTratamiento: e.target.value })}
                      className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white"
                    >
                      <option value="">Sin tratamiento específico</option>
                      {tratamientosDelAnimal.map((t) => (
                        <option key={t.idTratamiento} value={t.idTratamiento}>
                          {t.producto} ({t.dosis} {t.unidadDosis})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {ambito === 'lote' && (
                <div className="p-3.5 rounded-lg bg-surface-app border border-border-light">
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Identificador del Lote (`idLote`) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={36}
                    placeholder="Ej. LOTE-ENGORDA-01 o UUID del Lote"
                    value={form.idLote || ''}
                    onChange={(e) => setForm({ ...form, idLote: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Tipo (`tipo`) *
                  </label>
                  <select
                    required
                    value={form.tipo}
                    onChange={(e) => setForm({ ...form, tipo: e.target.value })}
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
                    Fecha Programada (`fechaProgramada`) *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={form.fechaProgramada}
                    onChange={(e) => setForm({ ...form, fechaProgramada: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                  Descripción (`descripcion`) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={250}
                  placeholder="Ej. Refuerzo de vacuna clostridial o aplicación de segunda dosis..."
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="w-full px-3 py-2 border border-border-light rounded-md text-[14px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Responsable (`idResponsable`)
                  </label>
                  <input
                    type="text"
                    maxLength={36}
                    placeholder="Encargado o ID responsable"
                    value={form.idResponsable || ''}
                    onChange={(e) => setForm({ ...form, idResponsable: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                    Estado (`estado`) *
                  </label>
                  <select
                    required
                    value={form.estado}
                    onChange={(e) => setForm({ ...form, estado: e.target.value })}
                    className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white"
                  >
                    {ESTADOS_RECORDATORIO.map((est) => (
                      <option key={est} value={est}>
                        {est}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-border-light text-brand-slate text-[14px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[14px] font-semibold disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : editingRecordatorio ? 'Guardar Cambios' : 'Programar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AgendaPage
