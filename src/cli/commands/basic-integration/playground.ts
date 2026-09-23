import { VERSION } from '@shared/config/version';
import { loadPlayground } from '@tui';

/** Launch the TUI primitives playground. */
export async function runPlayground(): Promise<void> {
  const { startPlayground } = await loadPlayground();
  startPlayground(VERSION);
}
