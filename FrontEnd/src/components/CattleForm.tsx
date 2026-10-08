import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, X } from 'lucide-react'
import type { Cattle, CattleInput, CattleSex } from '../types/cattle'

interface Props {
  animal: Cattle | null
  canSave: boolean
  onSave: (input: CattleInput, id?: number) => Promise<void>
  onClose: () => void
}

export function CattleForm({ animal, canSave, onSave, onClose }: Props) {
  const [form, setForm] = useState<CattleInput>({
    earTag: animal?.earTag || '', name: animal?.name || '',
    breed: animal?.breed || '', sex: animal?.sex || 'Hembra', birthDate: animal?.birthDate || null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstInput = useRef<HTMLInputElement>(null)

  useEffect(() => { firstInput.current?.focus() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ ...form, earTag: form.earTag.trim().toUpperCase(), name: form.name.trim(), breed: form.breed.trim() }, animal?.id)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar el bovino.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="form-title" className="mb-6 rounded-xl border-2 border-pasture/30 bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="form-title" className="font-display text-3xl font-semibold">{animal ? 'Editar bovino' : 'Registrar bovino'}</h2>
        <button aria-label="Cerrar formulario" className="button-secondary px-3" onClick={onClose} disabled={saving}><X size={18} /></button>
      </div>
      <form onSubmit={(event) => { void submit(event) }}>
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Datos del bovino</legend>
          <label className="text-sm font-semibold">Arete <span className="text-slate-500">(obligatorio)</span>
            <input ref={firstInput} className="form-input uppercase" autoComplete="off" required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9-]{0,39}" title="Letras, números y guiones; comienza con letra o número." placeholder="Ej. MX-001" value={form.earTag} onChange={(event) => setForm({ ...form, earTag: event.target.value })} />
          </label>
          <label className="text-sm font-semibold">Nombre <span className="text-slate-500">(opcional)</span>
            <input className="form-input" maxLength={80} placeholder="Ej. Luna" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="text-sm font-semibold">Raza <span className="text-slate-500">(obligatoria)</span>
            <input className="form-input" required maxLength={80} placeholder="Ej. Holstein o mestiza" value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} />
          </label>
          <label className="text-sm font-semibold">Sexo
            <select className="form-input" value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value as CattleSex })}><option>Hembra</option><option>Macho</option></select>
          </label>
          <label className="text-sm font-semibold">Fecha de nacimiento <span className="text-slate-500">(opcional)</span>
            <input className="form-input" type="date" max={new Date().toISOString().slice(0, 10)} value={form.birthDate || ''} onChange={(event) => setForm({ ...form, birthDate: event.target.value || null })} />
          </label>
        </fieldset>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {!canSave && <p role="status" className="mt-4 text-sm text-amber-800">Necesitas conexión con el servidor para guardar. Tus cambios siguen en el formulario.</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="button-primary" type="submit" disabled={saving || !canSave}><Check size={18} aria-hidden="true" />{saving ? 'Guardando…' : 'Guardar bovino'}</button>
          <button className="button-secondary" type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </section>
  )
}
