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
    // A handoff exit is owned by run-wizard's wait, not this screen.
    if (!store?.session.agentHandoff) process.exit(0);
  }, []);

  return null;
};
