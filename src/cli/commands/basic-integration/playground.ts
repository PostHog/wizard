import { VERSION } from '@shared/version';
import { loadPlayground } from '@tui';

/** Launch the TUI primitives playground. */
export async function runPlayground(): Promise<void> {
  const { startPlayground } = await loadPlayground();
  startPlayground(VERSION);
}
