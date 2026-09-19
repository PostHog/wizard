import { VERSION } from '@store/shared/version';
import { startPlayground } from '@tui/playground/start-playground';

/** Launch the TUI primitives playground. */
export function runPlayground(): void {
  startPlayground(VERSION);
}
