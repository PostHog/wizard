/** A program's detection, written into the session store before its run. */
import type { RunResult } from '@agent/types';
import { POSTHOG_DOCS_URL } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { WizardError } from '@shared/errors/wizard-error';
import { detectErrorCode } from './detect-map';
import type { ProgramConfig } from './program-step';
import type { CiRunnerContext } from './runner-context';
import type { WizardSession } from './session/wizard-session';
import type { SessionStore } from './session/session-store';

/**
 * Scan the project for `config`: a CI session runs the program's `ciPreRun`
 * when it has one, anything else its `onReady`. Marks detection complete.
 */
export async function detectProgram(
  config: ProgramConfig,
  store: SessionStore,
  runner: CiRunnerContext,
): Promise<void> {
  const ciPreRun = config.ciPreRun;
  if (store.session.ci && ciPreRun) {
    await store.edit((draft) => ciPreRun(draft, runner));
  } else {
    await config.onReady?.(store.readyContext());
  }
  store.setDetectionComplete();
}

/** What detection found that stops the run: an unsupported version or an unmet prerequisite. */
export function detectionFailure(
  config: ProgramConfig,
  session: WizardSession,
): NonNullable<RunResult['failure']> | null {
  if (session.unsupportedVersion) {
    const { current, minimum, docsUrl } = session.unsupportedVersion;
    const code = ErrorCodes.DetectUnsupportedVersion;
    return {
      code,
      message:
        `Detected framework version ${current} is not supported. ` +
        `Minimum supported version is ${minimum}.\n\nSee ${docsUrl}`,
      error: new WizardError(
        `${config.id} unsupported framework version`,
        { integration: config.id, current, minimum },
        code,
      ),
    };
  }
  const detectError = session.frameworkContext.detectError as
    | { kind: string; [key: string]: unknown }
    | undefined;
  if (!detectError) return null;
  const code = detectErrorCode(detectError.kind);
  const docsUrl =
    (typeof config.run === 'object' ? config.run.docsUrl : undefined) ??
    POSTHOG_DOCS_URL;
  return {
    code,
    message: `Prerequisites not met: ${detectError.kind}\n\nSee ${docsUrl}`,
    // `kind` stays in the detail: several kinds share one code.
    detail: { ...detectError },
    error: new WizardError(
      `${config.id} prerequisites failed`,
      { integration: config.id, detect_error_kind: detectError.kind },
      code,
    ),
  };
}
