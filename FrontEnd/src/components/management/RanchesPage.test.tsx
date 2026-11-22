import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CattleProvider } from '../../context/CattleContext';
import { db } from '../../lib/database/db';
import { AuthService } from '../../services/auth.service';
import RanchesPage from './RanchesPage';

describe('RanchesPage — Sección dedicada para registrar y administrar múltiples ranchos', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    AuthService.logout();
    await db.ranches.clear();
    await db.outbox.clear();
  });

  it('permite registrar múltiples ranchos, listarlos, buscarlos y editarlos', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    render(
      <MemoryRouter>
        <CattleProvider>
          <RanchesPage />
        </CattleProvider>
      </MemoryRouter>
    );

    expect(
      await screen.findByText(/Aún no tienes ranchos registrados/i)
    ).toBeInTheDocument();

    // Registrar primer rancho
    await user.type(screen.getByLabelText(/Nombre del rancho/i), 'Rancho El Encino');
    await user.type(screen.getByLabelText(/Ubicación general/i), 'Candelaria, Campeche');
    await user.click(screen.getByRole('button', { name: /Registrar Rancho/i }));

    expect(await screen.findByText('Rancho El Encino')).toBeInTheDocument();
    expect(screen.getByTestId('ranches-total-count')).toHaveTextContent('1');

    // Registrar segundo rancho
    await user.type(screen.getByLabelText(/Nombre del rancho/i), 'Rancho Santa Clara');
    await user.type(screen.getByLabelText(/Ubicación general/i), 'Palenque, Chiapas');
    await user.click(screen.getByRole('button', { name: /Registrar Rancho/i }));

    expect(await screen.findByText('Rancho Santa Clara')).toBeInTheDocument();
    expect(screen.getByTestId('ranches-total-count')).toHaveTextContent('2');
    expect(await db.ranches.count()).toBe(2);

    // Buscar por nombre
    await user.type(screen.getByLabelText(/Buscar rancho/i), 'Santa Clara');
    await waitFor(() => {
      expect(screen.queryByText('Rancho El Encino')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Rancho Santa Clara')).toBeInTheDocument();

    // Editar rancho encontrado
    await user.click(screen.getByRole('button', { name: /Editar/i }));
    const nameInput = screen.getByLabelText(/Nombre del rancho/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Rancho Santa Clara Norte');
    await user.click(screen.getByRole('button', { name: /Guardar Cambios/i }));

    expect(await screen.findByText('Rancho Santa Clara Norte')).toBeInTheDocument();
  });
});
