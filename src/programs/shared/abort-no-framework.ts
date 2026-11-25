import { ErrorCodes } from '@shared/errors';
import { POSTHOG_INSTALL_DOCS_URL } from '@shared/constants';
import { OutroKind, type OutroData } from '@shared/outro';
import { ProgramAbort } from '@programs/program-contract';

export type NoFrameworkGuidance = Pick<
  OutroData,
  'message' | 'docsLabel' | 'docsUrl'
>;

export function abortNoFrameworkDetected(
  overrides: NoFrameworkGuidance = {},
): never {
  const message = overrides.message ?? 'Could not detect a framework';
  const outroData: OutroData = {
    kind: OutroKind.Error,
    message,
    instruction: 'Run the wizard from an app root directory.',
    body: "That's the folder containing package.json or an equivalent project file.",
    docsLabel: 'Supported frameworks and manual setup:',
    docsUrl: POSTHOG_INSTALL_DOCS_URL,
    ...overrides,
  };
  // Hosts without an outro screen (CI) only see the message, so it carries the
  // recovery guidance too.
  throw new ProgramAbort({
    code: ErrorCodes.DetectNoFramework,
    message: [
      message,
      outroData.instruction,
      outroData.body,
      `${outroData.docsLabel} ${outroData.docsUrl}`,
    ].join('\n\n'),
    outroData,
  });
}
