import type { NonInteractiveMode } from './run';

/** User-facing label for a non-interactive mode. */
export function modeLabel(mode: NonInteractiveMode): string {
  return mode === 'headless' ? 'Headless' : 'CI';
}
