/**
 * ExitScreen — Final step in every program.
 *
 * Renders nothing. Immediately asks the host to end the run with 0.
 * The cleanup handler in start-tui.ts handles the exit summary line.
 */

import { useEffect } from 'react';
import type { WizardStore } from '../store';

export const ExitScreen = ({ store }: { store: WizardStore }) => {
  useEffect(() => {
    // After a mint failure the host owns the end (status 1, analytics).
    if (!store.mintHandoff) store.requestExit(0);
  }, []);

  return null;
};
