import type { ReactNode } from 'react';
import { useDeviceCapabilities } from '../../hooks/useDeviceCapabilities';

export interface ResponsiveColumn<T> {
  key: string;
  header: string;
  renderCell: (item: T) => ReactNode;
  hideOnCard?: boolean;
}

export interface ResponsiveDataViewProps<T> {
  items: T[];
  getKey: (item: T) => string;
  columns: ResponsiveColumn<T>[];
  renderCardHeader: (item: T) => ReactNode;
  renderCardActions?: (item: T) => ReactNode;
  emptyMessage?: string;
}

export default function ResponsiveDataView<T>({
  items,
  getKey,
  columns,
  renderCardHeader,
  renderCardActions,
  emptyMessage = 'Sin registros disponibles.'
}: ResponsiveDataViewProps<T>) {
  const { formFactor } = useDeviceCapabilities();

  if (items.length === 0) {
    return (
      <div className="p-6 rounded-xl border border-border-light bg-surface-white text-center text-[13px] text-brand-slate/65">
        {emptyMessage}
      </div>
    );
  }

  // En móvil renderiza tarjetas táctiles sin scroll horizontal forzado
  if (formFactor === 'mobile') {
    return (
      <div className="space-y-3">
        {items.map((item) => (
          <article
            key={getKey(item)}
            className="p-4 rounded-xl border border-border-light bg-surface-white shadow-sm space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2 border-b border-border-light pb-2">
              <div className="font-bold text-[14px] text-brand-slate">
                {renderCardHeader(item)}
              </div>
              {renderCardActions && <div className="shrink-0">{renderCardActions(item)}</div>}
            </div>

            <dl className="grid grid-cols-1 gap-1.5 text-[12px]">
              {columns
                .filter((col) => !col.hideOnCard)
                .map((col) => (
                  <div key={col.key} className="flex items-center justify-between gap-3">
                    <dt className="text-brand-slate/65 font-medium">{col.header}</dt>
                    <dd className="text-brand-slate font-semibold text-right">
                      {col.renderCell(item)}
                    </dd>
                  </div>
                ))}
            </dl>
          </article>
        ))}
      </div>
    );
  }

  const tableColumns = renderCardActions
    ? columns.filter((col) => col.key !== 'acciones' && col.key !== 'actions')
    : columns;

  // En tableta y escritorio renderiza tabla completa con foco y contraste accesible
  return (
    <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-white shadow-sm">
      <table className="w-full text-left border-collapse text-[13px]">
        <thead>
          <tr className="bg-surface-secondary/70 border-b border-border-light text-brand-slate/80">
            {tableColumns.map((col) => (
              <th key={col.key} className="py-3 px-4 font-bold">
                {col.header}
              </th>
            ))}
            {renderCardActions && <th className="py-3 px-4 font-bold text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {items.map((item) => (
            <tr
              key={getKey(item)}
              className="hover:bg-surface-secondary/40 transition-colors"
            >
              {tableColumns.map((col) => (
                <td key={col.key} className="py-3 px-4 text-brand-slate">
                  {col.renderCell(item)}
                </td>
              ))}
              {renderCardActions && (
                <td className="py-3 px-4 text-right">{renderCardActions(item)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
