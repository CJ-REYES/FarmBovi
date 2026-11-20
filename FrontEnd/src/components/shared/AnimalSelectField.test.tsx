import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnimalSelectField, { type AnimalSelectOption } from './AnimalSelectField';

const OPTIONS: AnimalSelectOption[] = [
  { id: 'a1', arete: '0455132595', raza: 'Indubrasil' },
  { id: 'a2', arete: '23456786786', raza: 'Indubrasil' },
  { id: 'a3', arete: '0455132541', raza: 'Cruzado', extraLabel: '(Último: 410.0 kg)' }
];

describe('AnimalSelectField — Selector desplegable con buscador interno por arete', () => {
  it('abre el desplegable con buscador interno, filtra por arete y selecciona con clic', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AnimalSelectField
        id="test-animal"
        label="Animal"
        required
        value=""
        options={OPTIONS}
        onChange={onChange}
      />
    );

    // El buscador NO está visible hasta abrir el desplegable
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    const trigger = screen.getByRole('combobox', { name: /Animal/i });
    await user.click(trigger);

    // Buscador aparece dentro del desplegable junto al listbox
    const searchInput = screen.getByRole('searchbox', { name: /Buscar animal por arete/i });
    const listbox = screen.getByRole('listbox', { name: /Animal/i });
    expect(within(listbox).getAllByRole('option')).toHaveLength(4); // placeholder + 3 animales

    await user.type(searchInput, '2541');

    expect(screen.getByText(/1 coincidencia/i)).toBeInTheDocument();
    const filtered = within(listbox).getAllByRole('option');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toHaveTextContent(/0455132541 — Cruzado/);

    await user.click(filtered[0]);
    expect(onChange).toHaveBeenCalledWith('a3');
    // Se cierra automáticamente al seleccionar
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('muestra aviso cuando no hay coincidencias y bloquea apertura cuando está deshabilitado', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AnimalSelectField
        id="test-animal"
        label="Animal"
        value=""
        options={OPTIONS}
        onChange={() => undefined}
      />
    );

    await user.click(screen.getByRole('combobox', { name: /Animal/i }));
    await user.type(screen.getByRole('searchbox'), '999999');
    expect(screen.getByText(/Sin coincidencias para "999999"/i)).toBeInTheDocument();

    rerender(
      <AnimalSelectField
        id="test-animal"
        label="Animal"
        disabled
        value="a1"
        options={OPTIONS}
        onChange={() => undefined}
      />
    );

    const disabledTrigger = screen.getByRole('combobox', { name: /Animal/i });
    expect(disabledTrigger).toBeDisabled();
    expect(disabledTrigger).toHaveTextContent(/0455132595 — Indubrasil/);
  });
});
