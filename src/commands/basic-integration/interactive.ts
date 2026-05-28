import type { Arguments } from 'yargs';
import { runWizard } from '@lib/runners';

/** Default flow: run the posthog-integration program through the TUI. */
export function runInteractive(argv: Arguments): void {
  void (async () => {
    const { posthogIntegrationConfig } = await import(
      '@lib/programs/posthog-integration/index'
    );
    runWizard(posthogIntegrationConfig, argv);
  })();
}
