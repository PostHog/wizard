/**
 * Open the run's notebook in the browser once, when an outro screen mounts.
 *
 * The notebook is where the report now lives, so the end of a run is the moment
 * the user wants it in front of them. The URL stays printed on the outro either
 * way — this only saves the copy/paste, and every failure is silent by design.
 */

import { useEffect, useRef } from 'react';
import { openTrackedLink } from '@utils/links';
import { isNonInteractiveEnvironment } from '@utils/environment';

export function useAutoOpenNotebook(notebookUrl: string | undefined): void {
  const opened = useRef(false);

  useEffect(() => {
    if (!notebookUrl || opened.current) return;
    // Outro screens only render under the TUI, but a piped/non-TTY session can
    // still get here — and spawning a browser out of one is never wanted.
    if (isNonInteractiveEnvironment()) return;
    opened.current = true;
    openTrackedLink(notebookUrl, 'outro-notebook-auto', { auto: true });
  }, [notebookUrl]);
}
