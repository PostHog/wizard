/**
 * The capture mode per allowlisted SDK for a run. Detection reads the installed
 * copies and resolves without flags; once the flags are known the run settles
 * the modes again from the same copies, so the files are read once.
 */
import type { Integration } from '@shared/constants';
import { WIZARD_SDK_CAPTURE_V1_FLAG_KEY } from '@shared/constants';
import {
  resolveSdkCaptureMode,
  type SdkCaptureModeResolution,
} from '@shared/sdk-capture-mode';
import {
  getSdkMajorRow,
  sdkRowsForIntegration,
  type SdkMajorRow,
} from '@shared/sdk-majors';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { readInstalledSdks } from './sdk-install';

/** Every row the integration installs: its main SDK and the ones beside it. */
function rowsFor(integration: Integration): SdkMajorRow[] {
  const { primary, secondary } = sdkRowsForIntegration(integration);
  return primary ? [primary, ...secondary] : [...secondary];
}

/** Reads the project once per SDK; a reader that throws counts as no installed copy. */
export async function detectSdkCaptureModes(
  installDir: string,
  integration: Integration,
  flagPayloads?: Readonly<Record<string, unknown>>,
): Promise<SdkCaptureModeResolution[]> {
  const flagPayload = flagPayloads?.[WIZARD_SDK_CAPTURE_V1_FLAG_KEY];
  const resolutions: SdkCaptureModeResolution[] = [];
  for (const row of rowsFor(integration)) {
    let installed: SdkCaptureModeResolution['installed'] = [];
    try {
      installed = await readInstalledSdks(installDir, row.sdk);
    } catch (error) {
      analytics.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { step: 'detectSdkCaptureModes', sdk: row.sdk },
      );
    }
    const resolution = resolveSdkCaptureMode({
      sdk: row.sdk,
      integration,
      installed,
      flagPayload,
    });
    logToFile('[sdk-capture-mode] resolved', resolution);
    resolutions.push(resolution);
  }
  return resolutions;
}

/** Resolves again with the flag payloads, from the copies detection already read. */
export function applySdkCaptureModeFlags(
  session: {
    integration: Integration | null;
    sdkCaptureModes: readonly SdkCaptureModeResolution[];
  },
  flagPayloads: Readonly<Record<string, unknown>>,
): SdkCaptureModeResolution[] {
  const flagPayload = flagPayloads[WIZARD_SDK_CAPTURE_V1_FLAG_KEY];
  return session.sdkCaptureModes.map((previous) =>
    resolveSdkCaptureMode({
      sdk: previous.sdk,
      integration: session.integration ?? undefined,
      installed: previous.installed,
      flagPayload,
    }),
  );
}

const MODE_LABEL = { legacy: 'legacy capture API', v1: 'capture v1 API' };

/** One prompt line per SDK, telling the agent which major line this run is on and why. */
export function sdkCaptureModeFacts(session: {
  sdkCaptureModes: readonly SdkCaptureModeResolution[];
}): string[] {
  return session.sdkCaptureModes.map((resolution) => {
    const row = getSdkMajorRow(resolution.sdk);
    if (resolution.mode === 'conflict') {
      const copies = resolution.installed
        .map((copy) => `${copy.version} from ${copy.source}`)
        .join(', ');
      return `PostHog SDK ${row.sdk}: the project has copies on different major lines (${copies}). Do not install, upgrade or remove either; report the conflict.`;
    }
    const line = `${resolution.major}.x`;
    const other =
      resolution.mode === 'v1'
        ? `${row.legacyMajor}.x`
        : `${row.firstV1Major}.x`;
    if (resolution.reason === 'installed') {
      const copy = resolution.installed[0];
      return `PostHog SDK ${row.sdk}: ${copy.version} is already installed (${
        copy.source
      }), the ${line} line (${
        MODE_LABEL[resolution.mode]
      }). Keep it; do not upgrade or downgrade it in this run.`;
    }
    return `PostHog SDK ${row.sdk}: this run uses the ${line} line (${
      MODE_LABEL[resolution.mode]
    }). Install ${line} only, never ${other}.`;
  });
}
