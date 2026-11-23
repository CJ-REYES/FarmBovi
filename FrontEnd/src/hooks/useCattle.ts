import { useContext } from 'react';
import { CattleContext, type CattleContextType } from '../context/cattle-context';

export function useSharedCattle(): CattleContextType {
  const context = useContext(CattleContext);
  if (!context) {
    throw new Error('useSharedCattle debe utilizarse dentro de un CattleProvider');
  }
  return context;
}

export function useCattle(): CattleContextType {
  return useSharedCattle();
}

export default useCattle;
