import { ErrorCodes } from '@shared/errors';
import { wizardAbort } from '@utils/wizard-abort';
import { OutroKind, type OutroData } from '@lib/wizard-session';

export function abortNoFrameworkDetected(
  overrides: Pick<OutroData, 'message' | 'docsLabel' | 'docsUrl'> = {},
): Promise<never> {
  const message = overrides.message ?? 'Could not detect a framework';
  return wizardAbort({
    code: ErrorCodes.DetectNoFramework,
    message,
    outroData: {
      kind: OutroKind.Error,
      message,
      instruction: 'Run the wizard from an app root directory.',
      body: "That's the folder containing package.json or an equivalent project file.",
      docsLabel: 'Supported frameworks and manual setup:',
      docsUrl: 'https://posthog.com/docs/libraries',
      ...overrides,
    },
  });
}
