import { useState } from 'react'
import { useCattle } from '../../hooks/useCattle'
import { Plus, Search, Trash2, Edit, Syringe } from 'lucide-react'
import { CattleForm } from '../../components/cattle/CattleForm'
import type { Cattle } from '../../types/cattle'

interface CattleListPageProps {
  onNavigateToSanidad?: () => void
}

export function CattleListPage({ onNavigateToSanidad }: CattleListPageProps) {
  const { cattle, loading, save, remove } = useCattle()
  const [searchTerm, setSearchTerm] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingCattle, setEditingCattle] = useState<Cattle | null>(null)

  const filteredCattle = cattle?.filter(
    (c) =>
      c.earTag.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.breed.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-condensed font-bold text-brand-forest">
            Expediente de Bovinos
          </h1>
          <p className="text-brand-slate/70 text-[15px] mt-1">
            Padrón activo del rancho vinculado con Sanidad, Tratamientos y Agenda.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {onNavigateToSanidad && (
            <button
              type="button"
              onClick={onNavigateToSanidad}
              className="px-4 py-2 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-brand-slate font-semibold text-[14px] flex items-center gap-2 transition-colors"
            >
              <Syringe size={17} className="text-brand-primary" /> Salud y Tratamientos
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditingCattle(null)
              setIsFormOpen(true)
            }}
            className="bg-brand-primary hover:bg-brand-dark text-white font-semibold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors text-[14px]"
          >
            <Plus size={18} /> Registrar Bovino
          </button>
        </div>
      </div>

      <div className="bg-surface-white rounded-xl shadow-xs border border-border-light overflow-hidden">
        <div className="p-4 border-b border-border-light">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" size={18} />
            <input
              type="text"
              placeholder="Buscar por arete, nombre o raza..."
              className="w-full pl-10 pr-4 py-2 bg-surface-app border border-border-light rounded-lg focus:border-brand-primary outline-none text-[14px]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[14px]">
            <thead className="bg-surface-app text-brand-slate/70 font-semibold border-b border-border-light">
              <tr>
                <th className="px-6 py-3.5">Arete</th>
                <th className="px-6 py-3.5">Nombre</th>
                <th className="px-6 py-3.5 hidden md:table-cell">Raza</th>
                <th className="px-6 py-3.5">Sexo</th>
                <th className="px-6 py-3.5 hidden sm:table-cell">Nacimiento</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-brand-slate/50">
                    Cargando registros...
                  </td>
                </tr>
              ) : filteredCattle?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-brand-slate/50">
                    No se encontraron bovinos registrados.
                  </td>
                </tr>
              ) : (
                filteredCattle?.map((animal) => (
                  <tr key={animal.id} className="hover:bg-surface-app/60">
                    <td className="px-6 py-3.5 font-bold text-brand-primary">{animal.earTag}</td>
                    <td className="px-6 py-3.5">{animal.name || '—'}</td>
                    <td className="px-6 py-3.5 hidden md:table-cell">{animal.breed}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          animal.sex === 'Hembra'
                            ? 'bg-pink-100 text-pink-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {animal.sex}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 hidden sm:table-cell text-brand-slate/70">
                      {animal.birthDate || '—'}
                    </td>
                    <td className="px-6 py-3.5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCattle(animal)
                          setIsFormOpen(true)
                        }}
                        className="p-1.5 text-brand-slate/60 hover:text-brand-primary bg-surface-app rounded-lg transition-colors"
                        title="Editar bovino"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar al bovino ${animal.earTag}?`)) {
                            void remove(animal.id)
                          }
                        }}
                        className="p-1.5 text-status-error/80 hover:text-status-error bg-status-error/10 rounded-lg transition-colors"
                        title="Eliminar bovino"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && (
        <CattleForm
          initialData={editingCattle}
          onSave={save}
          onClose={() => setIsFormOpen(false)}
        />
      )}
    </div>
  )
}
