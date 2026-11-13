import type { ReactElement } from 'react';
import { X } from 'lucide-react';

interface CattleFormProps {
  onClose: () => void;
}

export function CattleForm({ onClose }: CattleFormProps): ReactElement {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <h2 className="font-barlow text-xl font-bold text-farmbovi-blue">Registrar Bovino</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 font-source text-gray-500">
          <p>Formulario de registro en construcción...</p>
        </div>
      </div>
    </div>
  );
}
