import type { Arguments } from 'yargs';
import { runWizard } from '@cli/runners';
import { config as posthogIntegration } from '@programs/posthog-integration';

/** Default flow: run the posthog-integration program through the TUI. */
export function runInteractive(argv: Arguments): void {
  runWizard(posthogIntegration, argv);
}
