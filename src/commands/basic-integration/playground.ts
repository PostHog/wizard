import { VERSION } from '@lib/version';
import { startPlayground } from '@ui/tui/playground/start-playground';

/** Launch the TUI primitives playground. */
export function runPlayground(): void {
  startPlayground(VERSION);
}
