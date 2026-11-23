import { createContext, useContext } from 'react';

/** False while the terminal is too small and `ScreenContainer` hides the active screen, which stays mounted. */
export const ScreenVisibleContext = createContext(true);

export function useScreenVisible(): boolean {
  return useContext(ScreenVisibleContext);
}
