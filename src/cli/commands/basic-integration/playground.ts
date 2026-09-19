import { VERSION } from '@store';

/** Launch the TUI primitives playground. */
export async function runPlayground(): Promise<void> {
  const { startPlayground } = await import('@tui');
  startPlayground(VERSION);
}
