import type { Arguments } from 'yargs';
import { runWizard } from '../../runners/index.js';
import { posthogIntegrationConfig } from '@store/programs';

/** Default flow: run the posthog-integration program through the TUI. */
export function runInteractive(argv: Arguments): void {
  runWizard(posthogIntegrationConfig, argv);
}
