import { IS_PRODUCTION_BUILD } from '@env';
import { consoleLog } from '@shared/console-log';
import { ErrorCodes } from '@shared/errors';
import { emitWizardError } from '@shared/errors';

/** The "needs a TTY" message. Only dev/test builds accept `--ci`, so only they suggest it. */
export function nonInteractiveMessage(
  productionBuild: boolean = IS_PRODUCTION_BUILD,
): string {
  const intro =
    'This installer requires an interactive terminal (TTY) to run.\n' +
    'It appears you are running in a non-interactive environment.\n' +
    'Please run the wizard in an interactive terminal.\n\n';
  if (productionBuild) {
    return (
      intro +
      'Non-interactive setup is not available in published builds.\n' +
      'To set up PostHog without a terminal, follow the manual install guide:\n' +
      '  https://posthog.com/docs/getting-started/install'
    );
  }
  return (
    intro +
    'For CI/CD environments, use --ci mode:\n' +
    '  npx @posthog/wizard --ci --region us --api-key phx_xxx'
  );
}

/** Print the "needs a TTY" error and exit. Used when no `--ci` flag and no TTY. */
export function failNonInteractive(): void {
  consoleLog.intro('PostHog Wizard');
  consoleLog.log.error(nonInteractiveMessage());
  emitWizardError({
    code: ErrorCodes.CliInteractiveRequired,
    message: 'This installer requires an interactive terminal (TTY) to run.',
  });
  process.exit(1);
}
