/**
 * ExitScreen — Final step in every program.
 *
 * Renders nothing. Immediately exits the process.
 * The cleanup handler in start-tui.ts handles the exit summary line.
 */

import { useEffect } from 'react';
import type { WizardStore } from '../store';

export const ExitScreen = ({ store }: { store?: WizardStore }) => {
  useEffect(() => {
    // After a mint failure run-wizard owns the exit (status 1, analytics).
    if (!store?.session.mintHandoff) process.exit(0);
  }, []);

  return null;
};
