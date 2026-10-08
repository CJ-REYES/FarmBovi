import { useState } from 'react'
import { ArrowUpRight, CircleCheck, CloudOff, Leaf, Pencil, Plus, RefreshCw, Search, Tag, Trash2 } from 'lucide-react'
import { CattleForm } from './components/CattleForm'
import { PwaStatus } from './components/PwaStatus'
import { useCattle } from './hooks/useCattle'
import type { Cattle } from './types/cattle'

const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })

export default function App() {
  const { cattle, loading, source, savedAt, error, cacheAvailable, refresh, save, remove } = useCattle()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Cattle | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const canWrite = source === 'server' && !loading && removing === null
  const filtered = cattle.filter((animal) =>
    `${animal.earTag} ${animal.name} ${animal.breed} ${animal.sex}`.toLocaleLowerCase('es-MX').includes(search.toLocaleLowerCase('es-MX')),
  )

  function openForm(animal: Cattle | null) {
    setEditing(animal)
    setFormOpen(true)
    setNotice(null)
    setActionError(null)
  }

  async function deleteAnimal(animal: Cattle) {
    if (!window.confirm(`¿Eliminar el bovino con arete ${animal.earTag}? Esta acción borra su registro.`)) return
    setRemoving(animal.id)
    setActionError(null)
    setNotice(null)
    try {
      await remove(animal.id)
      setNotice(`Bovino ${animal.earTag} eliminado.`)
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'No se pudo eliminar el bovino.')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">Ir al contenido</a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="/" aria-label="FarmBovi, inicio" className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" width="42" height="42" />
            <span className="font-display text-3xl font-bold tracking-wide">FarmBovi<span className="ml-2 text-pasture">.</span></span>
          </a>
          <span role="status" className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${source === 'server' ? 'bg-pasture/10 text-pasture' : 'bg-slate-100 text-slate-600'}`}>
            {source === 'server' ? <CircleCheck size={16} aria-hidden="true" /> : <CloudOff size={16} aria-hidden="true" />}
            {loading ? 'Consultando servidor…' : source === 'server' ? 'Servidor disponible' : source === 'cache' ? 'Consulta guardada' : 'Servidor no disponible'}
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-pasture"><Leaf size={16} aria-hidden="true" />REGISTRO GANADERO</p>
            <h1 className="font-display text-5xl font-bold sm:text-6xl">Mi ganado</h1>
            <p className="mt-3 max-w-xl text-slate-600">Cada arete, una historia. Mantén los datos de tus bovinos a la mano.</p>
          </div>
          <button className="button-primary" disabled={!canWrite || formOpen} onClick={() => openForm(null)}><Plus size={20} aria-hidden="true" />Registrar bovino</button>
        </div>

        {source === 'cache' && <div role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <p className="font-semibold">Estás viendo una copia guardada en este dispositivo.</p>
          <p className="mt-1 text-sm">Última consulta: {savedAt ? dateTime.format(new Date(savedAt)) : 'sin fecha'}. Conecta con el servidor para actualizar o modificar registros.</p>
        </div>}
        {source === 'unavailable' && error && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
          <p className="font-semibold">No se pudo consultar el ganado.</p><p className="mt-1 text-sm">{error} Aún no hay un listado disponible para mostrar.</p>
        </div>}
        {actionError && <p role="alert" className="mb-6 rounded-lg bg-red-50 p-4 text-red-800">{actionError}</p>}
        {notice && <p role="status" className="mb-6 rounded-lg bg-pasture/10 p-4 text-pasture">{notice}</p>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <section aria-label="Resumen del ganado" className="mb-6 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {[
                { label: 'Bovinos registrados', value: cattle.length },
                { label: 'Hembras', value: cattle.filter((animal) => animal.sex === 'Hembra').length },
                { label: 'Machos', value: cattle.filter((animal) => animal.sex === 'Macho').length },
              ].map((stat) => <div key={stat.label} className="border-r border-slate-200 px-3 py-5 last:border-r-0 sm:px-6">
                <p className="font-display text-4xl font-semibold text-pasture">{loading && !savedAt || source === 'unavailable' ? '—' : stat.value}</p>
                <p className="mt-1 text-sm text-slate-600">{stat.label}</p>
              </div>)}
            </section>

            {formOpen && <CattleForm key={editing?.id || 'new'} animal={editing} canSave={canWrite} onSave={async (data, id) => {
              await save(data, id)
              setNotice(id ? 'Bovino actualizado.' : 'Bovino registrado.')
            }} onClose={() => { setFormOpen(false); setEditing(null) }} />}

            <section aria-labelledby="list-title" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
                <h2 id="list-title" className="font-display text-2xl font-semibold">Listado de bovinos</h2>
                <button className="button-secondary" onClick={refresh} disabled={loading || removing !== null}><RefreshCw size={16} aria-hidden="true" />{loading ? 'Actualizando…' : 'Actualizar'}</button>
              </div>
              <div className="p-5">
                <label className="relative block">
                  <span className="sr-only">Buscar por arete, nombre, raza o sexo</span>
                  <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={20} aria-hidden="true" />
                  <input className="form-input m-0 pl-10" type="search" placeholder="Buscar por arete, nombre o raza" value={search} onChange={(event) => setSearch(event.target.value)} />
                </label>
              </div>

              {loading && !savedAt ? <p role="status" className="px-5 pb-8 text-slate-500">Cargando el registro…</p> : cattle.length === 0 ? <div className="px-6 pb-10 pt-3 text-center">
                <Tag size={36} className="mx-auto mb-4 text-pasture" aria-hidden="true" />
                <h3 className="font-display text-3xl font-semibold">{source === 'unavailable' ? 'Tu listado aparecerá aquí' : 'Tu primer bovino empieza aquí'}</h3>
                <p className="mx-auto mt-2 max-w-sm text-slate-500">{source === 'unavailable' ? 'Inicia el servidor o recupera la conexión y presiona Actualizar.' : 'Registra un arete y sus datos para comenzar a organizar tu ganado.'}</p>
              </div> : filtered.length === 0 ? <p className="px-5 pb-8 text-slate-500">No hay bovinos que coincidan con tu búsqueda.</p> : <ul className="divide-y divide-slate-100">
                {filtered.map((animal) => <li key={animal.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="flex min-h-14 min-w-20 max-w-32 items-center justify-center break-all rounded-t-lg rounded-b-2xl border border-tag/50 bg-tag/20 px-3 py-2 text-center font-mono text-sm font-bold" aria-label={`Arete ${animal.earTag}`}>{animal.earTag}</div>
                  <div className="min-w-0 flex-1 basis-36">
                    <h3 className="break-words text-lg font-semibold">{animal.name || 'Sin nombre'}</h3>
                    <p className="break-words text-sm text-slate-500">{animal.breed} · {animal.sex}</p>
                    <p className="mt-1 text-xs text-slate-500">Nacimiento: {animal.birthDate ? dateOnly.format(new Date(`${animal.birthDate}T12:00:00`)) : 'Sin registrar'}</p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button className="button-secondary px-3" aria-label={`Editar bovino ${animal.earTag}`} disabled={!canWrite || formOpen} onClick={() => openForm(animal)}><Pencil size={17} /></button>
                    <button className="button-secondary px-3 text-red-700" aria-label={`Eliminar bovino ${animal.earTag}`} disabled={!canWrite || formOpen} onClick={() => { void deleteAnimal(animal) }}><Trash2 size={17} /></button>
                  </div>
                </li>)}
              </ul>}
              {cattle.length > 0 && <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">{filtered.length} de {cattle.length} bovinos{source === 'cache' ? ' · Datos guardados' : ''}</p>}
            </section>
          </div>

          <div className="space-y-5">
            <PwaStatus hasUnsavedChanges={formOpen} />
            <aside className="rounded-xl bg-pasture p-5 text-white" aria-label="Consejo sobre los aretes">
              <Tag size={24} className="mb-4 text-tag" aria-hidden="true" />
              <h2 className="font-display text-2xl font-semibold">Un arete por bovino</h2>
              <p className="mt-2 text-sm text-white/80">El arete identifica a cada animal. Usa un código único; FarmBovi te avisará si ya está registrado.</p>
            </aside>
            <div className="px-1 text-sm text-slate-500">
              {savedAt && <p>Última consulta: {dateTime.format(new Date(savedAt))}</p>}
              {source === 'server' && !cacheAvailable && <p className="mt-2 text-amber-800">El navegador no permitió guardar una copia local. Este listado requiere conexión.</p>}
              <a className="mt-4 inline-flex min-h-11 items-center gap-1 text-pasture underline underline-offset-4" href="https://github.com/CJ-REYES/FarmBovi/tree/main/docs" target="_blank" rel="noreferrer">Documentación de FarmBovi <ArrowUpRight size={15} aria-hidden="true" /></a>
            </div>
          </div>
        </div>
      </main>
      <footer className="mx-auto max-w-7xl px-5 pb-8 text-xs text-slate-500 sm:px-8">FarmBovi · Gestión ganadera · Base inicial del proyecto</footer>
    </div>
  )
}
