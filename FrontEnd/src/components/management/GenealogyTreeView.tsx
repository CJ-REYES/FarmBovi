import { Link } from 'react-router-dom';
import {
  ArrowDown,
  Baby,
  Dna,
  Edit3,
  ExternalLink,
  Plus,
  Users
} from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import type { AnimalGenealogyProfile } from '../../types/genealogy';

export interface GenealogyTreeViewProps {
  profile: AnimalGenealogyProfile;
  source?: 'server' | 'cache';
  loading?: boolean;
  onSelectAnimal: (animalId: string) => void;
  onRegisterOrEdit: (animalId: string) => void;
}

function formatBirthDate(iso?: string | null): string {
  if (!iso) return 'Sin fecha nac.';
  const datePart = iso.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return datePart;
  return parsed.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

interface AncestorCardProps {
  roleLabel: string;
  accentClass: string;
  animal: Cattle | null;
  emptyLabel: string;
  compact?: boolean;
  onSelectAnimal: (animalId: string) => void;
}

function AncestorCard({
  roleLabel,
  accentClass,
  animal,
  emptyLabel,
  compact = false,
  onSelectAnimal
}: AncestorCardProps) {
  if (!animal) {
    return (
      <div
        className={`rounded-xl border border-dashed border-border-dark/35 bg-surface-secondary/25 ${
          compact ? 'p-3' : 'p-4'
        } text-center flex flex-col items-center justify-center min-h-[82px]`}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-slate/50">
          {roleLabel}
        </span>
        <span className="text-[12px] text-brand-slate/55 mt-1">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectAnimal(animal.id)}
      className={`w-full text-left rounded-xl border border-border-light border-t-4 ${accentClass} bg-surface-white hover:border-brand-primary/50 hover:shadow-md transition-all ${
        compact ? 'p-3' : 'p-4'
      } cursor-pointer group`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-slate/60">
          {roleLabel}
        </span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-secondary/70 text-brand-slate/80">
          {animal.sexo}
        </span>
      </div>
      <p
        className={`font-bold text-brand-forest group-hover:text-brand-primary transition-colors mt-1 ${
          compact ? 'text-[14px]' : 'text-[16px]'
        }`}
      >
        {animal.arete}
      </p>
      <p className="text-[12px] text-brand-slate/70 truncate">
        {animal.raza} · {formatBirthDate(animal.fechaNacimiento)}
      </p>
      <span className="inline-block mt-1.5 text-[11px] font-semibold text-brand-primary/80 group-hover:underline">
        Ver árbol →
      </span>
    </button>
  );
}

export default function GenealogyTreeView({
  profile,
  source,
  loading = false,
  onSelectAnimal,
  onRegisterOrEdit
}: GenealogyTreeViewProps) {
  const {
    animal,
    record,
    observaciones,
    padre,
    madre,
    abueloPaterno,
    abuelaPaterna,
    abueloMaterno,
    abuelaMaterna,
    ancestros,
    descendientes,
    descendientesMultigeneracion,
    totalDescendientes,
    hasAnyGenealogyData
  } = profile;

  const hasGrandparents = Boolean(
    abueloPaterno || abuelaPaterna || abueloMaterno || abuelaMaterna
  );
  const deeperAncestors = ancestros.filter((a) => a.generacion >= 3);
  const deeperDescendants = descendientesMultigeneracion.filter((d) => d.generacion >= 2);

  return (
    <section
      aria-label={`Árbol genealógico de ${animal.arete}`}
      className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden"
    >
      {/* Barra superior del árbol */}
      <div className="px-5 py-4 border-b border-border-light bg-surface-app/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
            <Dna size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/55">
                Árbol Genealógico Real
              </p>
              {source && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    source === 'server'
                      ? 'bg-status-success/15 text-status-success'
                      : 'bg-status-warning/20 text-brand-dark'
                  }`}
                >
                  {source === 'server' ? 'Servidor' : 'Caché local'}
                </span>
              )}
              {loading && (
                <span className="text-[11px] text-brand-primary font-semibold">
                  Actualizando...
                </span>
              )}
            </div>
            <h2 className="text-lg font-condensed font-bold text-brand-forest">
              {animal.arete} — {animal.raza} ({animal.sexo})
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/cattle/${animal.id}`}
            className="min-h-[36px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <ExternalLink size={13} /> Expediente
          </Link>
          <button
            type="button"
            onClick={() => onRegisterOrEdit(animal.id)}
            className="min-h-[36px] px-3.5 bg-brand-primary hover:bg-brand-dark text-white rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            {record ? (
              <>
                <Edit3 size={13} /> Editar Parentesco
              </>
            ) : (
              <>
                <Plus size={14} /> Registrar Parentesco
              </>
            )}
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        {!hasAnyGenealogyData && (
          <div
            role="status"
            className="p-4 rounded-xl border border-dashed border-border-dark/35 bg-surface-secondary/25 text-center space-y-2"
          >
            <p className="text-[14px] font-bold text-brand-forest">
              Sin datos genealógicos registrados para {animal.arete}
            </p>
            <p className="text-[12px] text-brand-slate/75 max-w-xl mx-auto">
              Este ejemplar aún no tiene padre, madre ni descendientes registrados. El sistema no
              inventa ni genera parentescos automáticamente.
            </p>
            <button
              type="button"
              onClick={() => onRegisterOrEdit(animal.id)}
              className="mt-1 min-h-[38px] px-4 bg-brand-primary hover:bg-brand-dark text-white rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus size={14} /> Registrar Padre o Madre
            </button>
          </div>
        )}

        {/* Generación +3 o superior (cuando la API devuelve ancestros adicionales) */}
        {deeperAncestors.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/55 text-center">
              Generaciones Anteriores (+3 o más)
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {deeperAncestors.map((anc) => (
                <button
                  key={`${anc.generacion}-${anc.idHijo}-${anc.animal.idAnimal}`}
                  type="button"
                  onClick={() => onSelectAnimal(anc.animal.idAnimal)}
                  className="px-3 py-1.5 rounded-lg border border-border-light bg-surface-white hover:border-brand-primary text-left text-[12px] transition-colors cursor-pointer"
                >
                  <span className="text-[10px] font-bold uppercase text-brand-slate/60 mr-1.5">
                    Gen +{anc.generacion} ({anc.vinculo})
                  </span>
                  <span className="font-bold text-brand-forest">{anc.animal.arete}</span>
                  <span className="text-brand-slate/70 ml-1">· {anc.animal.raza}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Generación +2: Abuelos (solo si existe al menos un abuelo registrado) */}
        {hasGrandparents && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/55 text-center">
              Generación +2 · Abuelos
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <AncestorCard
                roleLabel="Abuelo Paterno"
                accentClass="border-t-sky-400"
                animal={abueloPaterno}
                emptyLabel="Sin registrar"
                compact
                onSelectAnimal={onSelectAnimal}
              />
              <AncestorCard
                roleLabel="Abuela Paterna"
                accentClass="border-t-pink-400"
                animal={abuelaPaterna}
                emptyLabel="Sin registrar"
                compact
                onSelectAnimal={onSelectAnimal}
              />
              <AncestorCard
                roleLabel="Abuelo Materno"
                accentClass="border-t-sky-400"
                animal={abueloMaterno}
                emptyLabel="Sin registrar"
                compact
                onSelectAnimal={onSelectAnimal}
              />
              <AncestorCard
                roleLabel="Abuela Materna"
                accentClass="border-t-pink-400"
                animal={abuelaMaterna}
                emptyLabel="Sin registrar"
                compact
                onSelectAnimal={onSelectAnimal}
              />
            </div>

            {/* Conector visual Abuelos -> Progenitores */}
            <div className="hidden lg:grid grid-cols-2 gap-6 px-12" aria-hidden="true">
              <div className="h-5 border-b-2 border-x-2 border-border-dark/25 rounded-b-lg" />
              <div className="h-5 border-b-2 border-x-2 border-border-dark/25 rounded-b-lg" />
            </div>
          </div>
        )}

        {/* Generación +1: Progenitores (Padre y Madre) */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/55 text-center">
            Generación +1 · Progenitores
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            <AncestorCard
              roleLabel="Padre (Semental)"
              accentClass="border-t-sky-600"
              animal={padre}
              emptyLabel="Padre no registrado"
              onSelectAnimal={onSelectAnimal}
            />
            <AncestorCard
              roleLabel="Madre (Vientre)"
              accentClass="border-t-pink-600"
              animal={madre}
              emptyLabel="Madre no registrada"
              onSelectAnimal={onSelectAnimal}
            />
          </div>

          {/* Conector visual Progenitores -> Ejemplar Seleccionado */}
          <div className="max-w-xl mx-auto flex flex-col items-center" aria-hidden="true">
            <div className="hidden sm:block w-1/2 h-5 border-b-2 border-x-2 border-brand-primary/35 rounded-b-lg" />
            <div className="w-0.5 h-5 bg-brand-primary/35" />
            <ArrowDown size={14} className="text-brand-primary/60 -mt-1" />
          </div>
        </div>

        {/* Nodo Central: Ejemplar Seleccionado */}
        <div className="max-w-md mx-auto">
          <div className="rounded-xl border-2 border-brand-primary bg-brand-primary/5 p-4 text-center shadow-sm space-y-1">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-primary text-white">
              Ejemplar Seleccionado
            </span>
            <p className="text-xl font-condensed font-bold text-brand-forest pt-1">
              {animal.arete}
            </p>
            <p className="text-[13px] text-brand-slate/80">
              {animal.raza} · {animal.sexo} · {animal.estado}
            </p>
            <p className="text-[12px] text-brand-slate/65">
              Nacimiento: {formatBirthDate(animal.fechaNacimiento)}
            </p>
            {observaciones && (
              <p className="text-[12px] text-brand-slate/80 pt-1 italic">
                “{observaciones}”
              </p>
            )}
          </div>
        </div>

        {/* Conector hacia Descendientes */}
        <div className="flex flex-col items-center" aria-hidden="true">
          <div className="w-0.5 h-5 bg-emerald-600/35" />
          <ArrowDown size={14} className="text-emerald-600/60 -mt-1" />
        </div>

        {/* Generación -1: Descendientes Directos */}
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2">
            <Baby size={15} className="text-emerald-600" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/60">
              Generación -1 · Descendientes Directos ({descendientes.length})
              {totalDescendientes > descendientes.length
                ? ` · Total multigeneración: ${totalDescendientes}`
                : ''}
            </p>
          </div>

          {descendientes.length === 0 ? (
            <div className="max-w-lg mx-auto p-4 rounded-xl border border-dashed border-border-dark/30 bg-surface-secondary/20 text-center">
              <p className="text-[12px] text-brand-slate/65 flex items-center justify-center gap-1.5">
                <Users size={14} className="text-brand-slate/45" />
                Sin descendientes registrados para {animal.arete}.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
              {descendientes.map((desc) => (
                <button
                  key={desc.animal.id}
                  type="button"
                  onClick={() => onSelectAnimal(desc.animal.id)}
                  className="text-left p-3.5 rounded-xl border border-border-light border-t-4 border-t-emerald-500 bg-surface-white hover:border-emerald-600/60 hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      {desc.role === 'padre'
                        ? 'Descendiente (Línea Paterna)'
                        : desc.role === 'madre'
                          ? 'Descendiente (Línea Materna)'
                          : 'Descendiente'}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-secondary/70 text-brand-slate/80">
                      {desc.animal.sexo}
                    </span>
                  </div>
                  <p className="text-[15px] font-bold text-brand-forest group-hover:text-brand-primary transition-colors mt-1">
                    {desc.animal.arete}
                  </p>
                  <p className="text-[12px] text-brand-slate/70">
                    {desc.animal.raza} · {formatBirthDate(desc.animal.fechaNacimiento)}
                  </p>
                  <span className="inline-block mt-1.5 text-[11px] font-semibold text-emerald-700 group-hover:underline">
                    Explorar descendencia →
                  </span>
                </button>
              ))}
            </div>
          )}

          {deeperDescendants.length > 0 && (
            <div className="pt-2 space-y-2 max-w-4xl mx-auto">
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/55 text-center">
                Descendencia Extendida (Nietos y siguientes generaciones)
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {deeperDescendants.map((desc) => (
                  <button
                    key={`${desc.generacion}-${desc.descendiente.idAnimal}`}
                    type="button"
                    onClick={() => onSelectAnimal(desc.descendiente.idAnimal)}
                    className="px-3 py-1.5 rounded-lg border border-border-light bg-surface-white hover:border-emerald-600 text-left text-[12px] transition-colors cursor-pointer"
                  >
                    <span className="text-[10px] font-bold uppercase text-emerald-700 mr-1.5">
                      Gen -{desc.generacion}
                    </span>
                    <span className="font-bold text-brand-forest">{desc.descendiente.arete}</span>
                    <span className="text-brand-slate/70 ml-1">
                      · {desc.descendiente.raza} ({desc.descendiente.sexo})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
