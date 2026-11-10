import { useState } from 'react';
import { useCattle } from '../../hooks/useCattle';
import { Plus, Search, Trash2, Edit } from 'lucide-react';
import { CattleForm } from '../../components/cattle/CattleForm';

export function CattleListPage() {
  // Corrección: Se ajustan 'loading' y 'remove' a tu contrato actual
  const { cattle, loading, remove } = useCattle();
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);

  const filteredCattle = cattle?.filter(c =>
    c.earTag.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-barlow font-bold text-farmbovi-green-dark">Gestión de Bovinos</h1>
        <button
          onClick={() => setIsFormOpen(true)}
          className="bg-farmbovi-gold hover:bg-yellow-500 text-white font-source font-semibold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
        >
          <Plus size={20} /> Registrar Bovino
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Buscar por arete o nombre..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-farmbovi-green focus:border-farmbovi-green outline-none font-source"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-source">
            <thead className="bg-farmbovi-light text-farmbovi-blue font-semibold">
              <tr>
                <th className="px-6 py-4">Arete</th>
                <th className="px-6 py-4">Nombre</th>
                <th className="px-6 py-4 hidden md:table-cell">Raza</th>
                <th className="px-6 py-4">Sexo</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-500">Cargando registros...</td></tr>
              ) : filteredCattle?.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-500">No se encontraron bovinos.</td></tr>
              ) : (
                filteredCattle?.map((animal) => (
                  <tr key={animal.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-bold text-farmbovi-green">{animal.earTag}</td>
                    <td className="px-6 py-4">{animal.name}</td>
                    <td className="px-6 py-4 hidden md:table-cell">{animal.breed}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${animal.sex === 'Hembra' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>
                        {animal.sex}
                      </span>
                    </td>
                    <td className="px-6 py-4 flex justify-end gap-2">
                      <button className="p-2 text-gray-500 hover:text-farmbovi-blue bg-gray-100 rounded-lg transition-colors"><Edit size={18} /></button>
                      <button
                        onClick={() => {
                          // Corrección: usar 'remove' en lugar de deleteCattle
                          if(window.confirm(`¿Eliminar al bovino ${animal.earTag}?`)) remove(animal.id!);
                        }}
                        className="p-2 text-red-500 hover:text-red-700 bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && <CattleForm onClose={() => setIsFormOpen(false)} />}
    </div>
  );
}
