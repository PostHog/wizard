import type { Arguments } from 'yargs';
import { runWizard } from '@lib/runners';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';

/** Default flow: run the posthog-integration program through the TUI. */
export function runInteractive(argv: Arguments): void {
  runWizard(posthogIntegrationConfig, argv);
}
