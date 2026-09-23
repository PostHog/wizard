import type { TuiHost } from '@tui/types';
import { setUI } from './ui';
import { wizardAbort } from './wizard-abort';

/** What every CLI entry hands the TUI: install its UI as current, and the abort path. */
export function cliTuiHost(): TuiHost {
  return {
    onUi: (ui) => setUI(ui),
    abort: (failure) => wizardAbort(failure),
  };
}
