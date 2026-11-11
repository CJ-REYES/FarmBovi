import { createContext, useContext, type ReactNode } from 'react';
import { useCattle } from '../hooks/useCattle';

// Inferimos el tipo de retorno de tu hook existente
type CattleContextType = ReturnType<typeof useCattle>;

const CattleContext = createContext<CattleContextType | undefined>(undefined);

export function CattleProvider({ children }: { children: ReactNode }) {
  const cattleState = useCattle(); // Se ejecuta UNA sola vez en el ciclo de vida raíz
  return (
    <CattleContext.Provider value={cattleState}>
      {children}
    </CattleContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSharedCattle() {
  const context = useContext(CattleContext);
  if (context === undefined) {
    throw new Error('useSharedCattle debe usarse dentro de un CattleProvider');
  }
  return context;
}
