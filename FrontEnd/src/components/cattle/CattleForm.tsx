import { useState, type FormEvent, type ReactElement } from 'react'
import { X } from 'lucide-react'
import type { Cattle, CattleInput, CattleSex } from '../../types/cattle'

interface CattleFormProps {
  initialData?: Cattle | null
  onSave: (data: CattleInput, id?: number) => Promise<void>
  onClose: () => void
}

export function CattleForm({ initialData, onSave, onClose }: CattleFormProps): ReactElement {
  const [earTag, setEarTag] = useState(initialData?.earTag || '')
  const [name, setName] = useState(initialData?.name || '')
  const [breed, setBreed] = useState(initialData?.breed || '')
  const [sex, setSex] = useState<CattleSex>(initialData?.sex || 'Hembra')
  const [birthDate, setBirthDate] = useState(initialData?.birthDate || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(
        {
          earTag: earTag.trim().toUpperCase(),
          name: name.trim(),
          breed: breed.trim(),
          sex,
          birthDate: birthDate ? birthDate : null,
        },
        initialData?.id
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el bovino.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-white rounded-xl shadow-lg w-full max-w-md overflow-hidden border border-border-light">
        <div className="flex justify-between items-center px-5 py-4 border-b border-border-light bg-surface-app">
          <h2 className="font-condensed text-xl font-bold text-brand-forest">
            {initialData ? 'Editar Bovino' : 'Registrar Bovino'}
          </h2>
          <button type="button" onClick={onClose} className="text-brand-slate/50 hover:text-brand-slate">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
              Arete SINIIGA / Identificador *
            </label>
            <input
              type="text"
              required
              maxLength={40}
              placeholder="Ej. MX-00142"
              value={earTag}
              onChange={(e) => setEarTag(e.target.value)}
              className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
              Nombre (opcional)
            </label>
            <input
              type="text"
              maxLength={80}
              placeholder="Ej. Estrella"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                Raza *
              </label>
              <input
                type="text"
                required
                maxLength={80}
                placeholder="Ej. Brahman, Suizo..."
                value={breed}
                onChange={(e) => setBreed(e.target.value)}
                className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
                Sexo *
              </label>
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as CattleSex)}
                className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] bg-surface-white focus:outline-none focus:border-brand-primary"
              >
                <option value="Hembra">Hembra</option>
                <option value="Macho">Macho</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-brand-slate/70 mb-1">
              Fecha de Nacimiento
            </label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full px-3 py-2 border border-border-light rounded-md text-[14px] focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-light">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-border-light text-brand-slate text-[14px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-md bg-brand-primary hover:bg-brand-dark text-white font-semibold text-[14px] disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar Bovino'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
