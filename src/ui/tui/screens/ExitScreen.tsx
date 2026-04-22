/**
 * ExitScreen — Final step in every workflow.
 *
 * Renders nothing. Immediately exits the process.
 * The cleanup handler in start-tui.ts handles the exit summary line.
 */

import { useEffect } from 'react';

export const ExitScreen = () => {
  useEffect(() => {
    process.exit(0);
  }, []);

  return null;
};
