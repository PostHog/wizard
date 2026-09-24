import { ErrorCodes } from '@shared/errors';
import { wizardAbort } from '@utils/wizard-abort';

const NO_FRAMEWORK_MESSAGE =
  'Could not auto-detect your framework for this project.\n\n' +
  "Run the wizard from your app's root directory (where its package.json or " +
  'equivalent project file lives). See supported frameworks and manual setup instructions at:\n' +
  '  https://posthog.com/docs/libraries';

export function abortNoFrameworkDetected(
  message = NO_FRAMEWORK_MESSAGE,
): Promise<never> {
  return wizardAbort({ code: ErrorCodes.DetectNoFramework, message });
}
