import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSharedCattle } from '../../context/CattleContext';
import type { CattleInput, Cattle } from '../../types/cattle';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';

export default function CattleForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { cattle, save } = useSharedCattle();

  const isEditMode = Boolean(id);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState<CattleInput>({
    areteSiniiga: '',
    nombre: '',
    raza: '',
    gender: 'Hembra', // Valor por defecto
    fechaNacimiento: ''
  });

  useEffect(() => {
    if (isEditMode && cattle.length > 0) {
      const existingCattle = cattle.find(c => c.id === Number(id)) as Cattle & CattleInput;
      if (existingCattle) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFormData({
          areteSiniiga: existingCattle.areteSiniiga || '',
          nombre: existingCattle.nombre || '',
          raza: existingCattle.raza || '',
          gender: existingCattle.gender || 'Hembra',
          fechaNacimiento: existingCattle.fechaNacimiento
            ? new Date(existingCattle.fechaNacimiento).toISOString().split('T')[0]
            : ''
        });
      }
    }
  }, [id, cattle, isEditMode]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      // Validaciones básicas de negocio
      if (!formData.areteSiniiga || !formData.raza) {
        throw new Error("El arete y la raza son obligatorios.");
      }

      await save(formData, isEditMode ? Number(id) : undefined);
      navigate('/cattle');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Ocurrió un error inesperado al procesar la solicitud.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
      <header className="flex items-center gap-4 border-b border-border-light pb-4">
        <button onClick={() => navigate('/cattle')} className="p-2 bg-surface-white border border-border-light rounded-md text-brand-slate/60 hover:text-brand-primary transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            {isEditMode ? 'Edición de Registro' : 'Nuevo Registro'}
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight">
            {isEditMode ? 'Actualizar Bovino' : 'Registrar Bovino'}
          </h1>
        </div>
      </header>

      {errorMsg && (
        <div className="p-4 bg-status-error/10 border border-status-error/20 text-status-error text-[13px] font-semibold rounded-lg">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">

          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-brand-slate">Arete Oficial (SINIIGA) <span className="text-status-error">*</span></label>
            <input
              type="text" name="areteSiniiga" required
              value={formData.areteSiniiga} onChange={handleChange}
              placeholder="Ej. MX 0842"
              className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none uppercase"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-brand-slate">Nombre / Alias (Opcional)</label>
            <input
              type="text" name="nombre"
              value={formData.nombre} onChange={handleChange}
              placeholder="Ej. La pinta"
              className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-brand-slate">Raza <span className="text-status-error">*</span></label>
            <select
              name="raza" required
              value={formData.raza} onChange={handleChange}
              className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
            >
              <option value="">Selecciona una raza</option>
              <option value="Brahman">Brahman</option>
              <option value="Suizo">Suizo</option>
              <option value="Angus">Angus</option>
              <option value="Indubrasil">Indubrasil</option>
              <option value="Gyr">Gyr</option>
              <option value="Cruzado">Cruzado / Mestizo</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-brand-slate">Sexo <span className="text-status-error">*</span></label>
            <select
              name="gender" required
              value={formData.gender} onChange={handleChange}
              className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
            >
              <option value="Hembra">Hembra</option>
              <option value="Macho">Macho</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-brand-slate">Fecha de Nacimiento</label>
            <input
              type="date" name="fechaNacimiento"
              value={formData.fechaNacimiento} onChange={handleChange}
              className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
            />
          </div>
        </div>

        <div className="bg-surface-secondary/30 border-t border-border-light p-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/cattle')} className="px-4 h-[38px] text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary rounded-md transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-6 h-[38px] rounded-md font-semibold text-[13px] transition-colors shadow-sm disabled:opacity-50">
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isEditMode ? 'Guardar Cambios' : 'Registrar Bovino'}
          </button>
        </div>
      </form>
    </div>
  );
}
