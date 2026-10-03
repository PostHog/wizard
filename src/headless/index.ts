/** Headless's one entry for other layers; `runHeadless` loads the host on first call. */
import type { ProgramConfig } from '@programs/types';
import type { HeadlessLaunch } from './run';

export type { HeadlessLaunch, NonInteractiveMode } from './run';
export { modeLabel } from './mode-label';

/** Run `config` headlessly; resolves with the exit code. */
export async function runHeadless(
  config: ProgramConfig,
  launch: HeadlessLaunch,
): Promise<number> {
  const { runHeadless: run } = await import('./run');
  return run(config, launch);
}
