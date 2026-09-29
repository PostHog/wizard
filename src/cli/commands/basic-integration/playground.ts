import { VERSION } from '@shared/version';
import { runPlayground as runTuiPlayground } from '@tui';
import { exitWith } from '@cli/runners';

/** Launch the TUI primitives playground, and exit once it closes. */
export function runPlayground(): void {
  exitWith(() => runTuiPlayground(VERSION));
}
