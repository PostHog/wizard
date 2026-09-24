import type { TuiHost } from '@tui/start-tui';
import { setUI } from '@cli/ui';
import { wizardAbort } from '@cli/wizard-abort';

/** What every CLI entry hands the TUI: install its UI as current, and the abort path. */
export function cliTuiHost(): TuiHost {
  return {
    onUi: (ui) => setUI(ui),
    abort: (failure) => wizardAbort(failure),
  };
}
