import { getUI } from '@ui';

/** Print the "needs a TTY" error and exit. Used when no `--ci` flag and no TTY. */
export function failNonInteractive(): void {
  getUI().intro('PostHog Wizard');
  getUI().log.error(
    'This installer requires an interactive terminal (TTY) to run.\n' +
      'It appears you are running in a non-interactive environment.\n' +
      'Please run the wizard in an interactive terminal.\n\n' +
      'For CI/CD environments, use --ci mode:\n' +
      '  npx @posthog/wizard --ci --region us --api-key phx_xxx',
  );
  process.exit(1);
}
