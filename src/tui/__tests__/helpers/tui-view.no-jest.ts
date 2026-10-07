/** A step predicate's input for tests: a fresh session and the TUI's defaults, both writable. */
import { buildSession } from '@programs';
import type { SessionArgs, WizardSession } from '@programs/types';
import {
  initialTuiState,
  type TuiLaunchChoices,
  type TuiState,
} from '@tui/tui-state';

export type TestTuiView = TuiState & { session: WizardSession };

export function tuiView(
  args: SessionArgs = {},
  choices: TuiLaunchChoices = {},
): TestTuiView {
  return { ...initialTuiState(choices), session: buildSession(args) };
}
