import type { Arguments } from 'yargs';
import { runWizard } from '@cli/runners';
import { posthogIntegrationConfig } from '@programs';

/** Default flow: run the posthog-integration program through the TUI. */
export function runInteractive(argv: Arguments): void {
  runWizard(posthogIntegrationConfig, argv);
}
