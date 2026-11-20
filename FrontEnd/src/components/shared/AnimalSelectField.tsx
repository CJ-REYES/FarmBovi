import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface AnimalSelectOption {
  id: string;
  arete: string;
  raza?: string;
  extraLabel?: string;
}

export interface AnimalSelectFieldProps {
  id: string;
  name?: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  value: string;
  options: AnimalSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  helperText?: string;
  error?: string;
  selectClassName?: string;
  onChange: (animalId: string) => void;
}

function formatOptionLabel(option: AnimalSelectOption): string {
  const parts: string[] = [option.arete || option.id];
  if (option.raza) {
    parts.push(option.raza);
  }
  const base = parts.join(' — ');
  return option.extraLabel ? `${base} ${option.extraLabel}` : base;
}

export default function AnimalSelectField({
  id,
  name = 'idAnimal',
  label,
  required = false,
  disabled = false,
  value,
  options,
  placeholder = 'Selecciona un animal',
  searchPlaceholder = 'Buscar por arete o raza…',
  helperText,
  error,
  selectClassName,
  onChange
}: AnimalSelectFieldProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.id === value) ?? null,
    [options, value]
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    if (!trimmedQuery) return options;
    return options.filter((opt) => {
      const arete = (opt.arete || '').toLowerCase();
      const raza = (opt.raza || '').toLowerCase();
      const extra = (opt.extraLabel || '').toLowerCase();
      return (
        arete.includes(trimmedQuery) ||
        raza.includes(trimmedQuery) ||
        extra.includes(trimmedQuery)
      );
    });
  }, [options, trimmedQuery]);

  // Cerrar el desplegable al hacer clic fuera
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  // Enfocar automáticamente el buscador dentro del desplegable al abrir
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    }
  }, [isOpen]);

  const handleSelect = (nextId: string) => {
    onChange(nextId);
    setIsOpen(false);
    setSearchQuery('');
  };

  const listboxId = `${id}-listbox`;

  return (
    <div ref={containerRef} className="space-y-1.5 relative">
      <label htmlFor={id} className="block text-[13px] font-semibold text-brand-slate">
        {label} {required && <span className="text-status-error">*</span>}
      </label>

      {/* Input oculto para compatibilidad con formularios nativos */}
      <input type="hidden" name={name} value={value} />

      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-required={required}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => {
            const next = !prev;
            if (!next) setSearchQuery('');
            return next;
          });
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            if (!isOpen) {
              e.preventDefault();
              setIsOpen(true);
            }
          } else if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            setIsOpen(false);
            setSearchQuery('');
          }
        }}
        className={
          selectClassName ||
          'w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-left flex items-center justify-between gap-2 outline-none focus:border-brand-primary disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer'
        }
      >
        <span
          className={`truncate ${
            selectedOption ? 'text-brand-slate font-medium' : 'text-brand-slate/55'
          }`}
        >
          {selectedOption ? formatOptionLabel(selectedOption) : placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`text-brand-slate/55 shrink-0 transition-transform ${
            isOpen ? 'rotate-180 text-brand-primary' : ''
          }`}
        />
      </button>

      {/* Desplegable con buscador integrado en el encabezado */}
      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-white border border-border-light rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border-light bg-surface-app/70">
            <div className="relative">
              <Search
                size={15}
                aria-hidden="true"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-slate/45 pointer-events-none"
              />
              <input
                ref={searchInputRef}
                type="search"
                aria-label={`Buscar ${label.toLowerCase()} por arete`}
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsOpen(false);
                    setSearchQuery('');
                  } else if (e.key === 'Enter' && filteredOptions.length > 0) {
                    e.preventDefault();
                    handleSelect(filteredOptions[0].id);
                  }
                }}
                className="w-full min-h-[36px] pl-8 pr-7 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate placeholder:text-brand-slate/45 outline-none focus:border-brand-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Limpiar búsqueda de arete"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-brand-slate/50 hover:text-brand-slate rounded"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {trimmedQuery && (
              <p className="text-[11px] text-brand-slate/60 mt-1 px-0.5">
                {filteredOptions.length === 0
                  ? `Sin coincidencias para "${searchQuery.trim()}"`
                  : `${filteredOptions.length} coincidencia${filteredOptions.length === 1 ? '' : 's'}`}
              </p>
            )}
          </div>

          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="max-h-56 overflow-y-auto py-1 divide-y divide-border-light/40"
          >
            {!trimmedQuery && (
              <li
                role="option"
                aria-selected={value === ''}
                onClick={() => handleSelect('')}
                className={`px-3 py-2 text-[13px] cursor-pointer flex items-center justify-between ${
                  value === ''
                    ? 'bg-brand-primary/10 text-brand-primary font-semibold'
                    : 'text-brand-slate/65 hover:bg-surface-secondary/70'
                }`}
              >
                <span>{placeholder}</span>
                {value === '' && <Check size={14} />}
              </li>
            )}

            {filteredOptions.length === 0 ? (
              <li className="px-3 py-4 text-center text-[12px] text-brand-slate/55">
                No se encontró ningún animal con ese arete o raza.
              </li>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option.id === value;
                return (
                  <li
                    key={option.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(option.id)}
                    className={`px-3 py-2.5 text-[13px] cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? 'bg-brand-primary text-white font-semibold'
                        : 'text-brand-slate hover:bg-brand-primary/10'
                    }`}
                  >
                    <span className="truncate">{formatOptionLabel(option)}</span>
                    {isSelected && <Check size={14} className="shrink-0" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      {helperText && <p className="text-[11px] text-brand-slate/55">{helperText}</p>}

      {error && (
        <p role="alert" className="text-[12px] text-status-error font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
