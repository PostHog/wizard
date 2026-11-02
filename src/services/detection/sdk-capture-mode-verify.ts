/**
 * The read-back: after the agent installs or touches an SDK, the project's
 * dependency files decide whether the run is still on the major line it was
 * set up for. A copy on the other line fails the run, because the code the
 * agent wrote from that line's references would not match what is installed.
 */
import type { AgentFailure } from '@agent/types';
import { ErrorCodes, WizardError } from '@shared/errors';
import type {
  InstalledSdk,
  SdkCaptureModeResolution,
} from '@shared/sdk-capture-mode';
import { getSdkMajorRow, modeForInstalledMajor } from '@shared/sdk-majors';
import { analytics } from '@utils/analytics';
import { readInstalledSdks } from './sdk-install';

export interface SdkVerifySession {
  readonly installDir: string;
  readonly sdkCaptureModes: readonly SdkCaptureModeResolution[];
}

const MODE_LINE = { legacy: 'legacy capture API', v1: 'capture v1 API' };

function describe(copy: InstalledSdk): string {
  return `${copy.version} (${copy.source})`;
}

/** The first installed copy whose major line differs from the mode the run resolved, per SDK. */
export async function findSdkMajorMismatch(
  session: SdkVerifySession,
): Promise<
  { resolution: SdkCaptureModeResolution; offending: InstalledSdk } | undefined
> {
  for (const resolution of session.sdkCaptureModes) {
    if (resolution.mode === 'conflict') continue;
    const row = getSdkMajorRow(resolution.sdk);
    let installed: InstalledSdk[];
    try {
      installed = await readInstalledSdks(session.installDir, resolution.sdk);
    } catch (error) {
      analytics.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { step: 'verifySdkCaptureModes', sdk: resolution.sdk },
      );
      continue;
    }
    const offending = installed.find(
      (copy) => modeForInstalledMajor(row, copy.major) !== resolution.mode,
    );
    if (offending) return { resolution, offending };
  }
  return undefined;
}

/** The run failure for a mismatch, or undefined when every copy is on its line. */
export async function verifySdkCaptureModes(
  session: SdkVerifySession,
): Promise<AgentFailure | undefined> {
  if (session.sdkCaptureModes.length === 0) return undefined;
  const mismatch = await findSdkMajorMismatch(session);
  if (!mismatch) return undefined;
  const { resolution, offending } = mismatch;
  if (resolution.mode === 'conflict') return undefined;
  const row = getSdkMajorRow(resolution.sdk);
  const pin = row.pins[resolution.mode];
  const code = ErrorCodes.AgentSdkMajorMismatch;
  const message =
    `This run set up ${row.sdk} for the ${resolution.major}.x line (${
      MODE_LINE[resolution.mode]
    }), but ${describe(offending)} is installed now. ` +
    `The code written in this run does not match that version.\n\n` +
    `Change the ${row.sdk} dependency to ${pin}, or remove it, then run the wizard again.`;
  return {
    code,
    message,
    detail: {
      sdk: row.sdk,
      capture_mode: resolution.mode,
      expected_major: resolution.major,
      installed_version: offending.version,
      installed_source: offending.source,
    },
    error: new WizardError(
      'SDK major mismatch after install',
      { sdk: row.sdk, mode: resolution.mode, installed: offending.version },
      code,
    ),
  };
}

/** The pre-agent stop for a project whose copies of one SDK disagree on the major line. */
export function sdkConflictFailure(session: {
  readonly sdkCaptureModes: readonly SdkCaptureModeResolution[];
}): AgentFailure | undefined {
  const conflict = session.sdkCaptureModes.find(
    (resolution) => resolution.mode === 'conflict',
  );
  if (!conflict) return undefined;
  const copies = conflict.installed.map(describe).join(' and ');
  const code = ErrorCodes.DetectSdkMajorConflict;
  return {
    code,
    message:
      `The project has copies of ${conflict.sdk} on different major lines: ${copies}. ` +
      `Pick one line, remove the other, then run the wizard again.`,
    detail: {
      sdk: conflict.sdk,
      installed: conflict.installed.map((copy) => ({ ...copy })),
    },
    error: new WizardError(
      'SDK major conflict',
      { sdk: conflict.sdk, copies: conflict.installed.length },
      code,
    ),
  };
}
