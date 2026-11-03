/**
 * The capture mode per allowlisted SDK for a run. Detection reads the installed
 * copies and resolves without flags; once the flags are known the run settles
 * the modes again from the same copies, so the files are read once.
 */
import type { Integration } from '@shared/constants';
import { WIZARD_SDK_CAPTURE_V1_FLAG_KEY } from '@shared/constants';
import {
  isSdkCaptureModeEnabled,
  resolveSdkCaptureMode,
  type SdkCaptureModeResolution,
  type SdkFloorCheck,
} from '@shared/sdk-capture-mode';
import type { WizardFlagSnapshot } from '@shared/wizard-flags';
import {
  getSdkMajorRow,
  sdkRowsForIntegration,
  type SdkMajorRow,
} from '@shared/sdk-majors';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { checkSdkFloor } from './sdk-floors';
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
): Promise<SdkCaptureModeResolution[]> {
  const resolutions: SdkCaptureModeResolution[] = [];
  for (const row of rowsFor(integration)) {
    let installed: SdkCaptureModeResolution['installed'] = [];
    let floor: SdkFloorCheck | undefined;
    try {
      installed = await readInstalledSdks(installDir, row.sdk);
      floor = await checkSdkFloor(installDir, row.sdk);
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
      floor,
    });
    logToFile('[sdk-capture-mode] resolved', resolution);
    resolutions.push(resolution);
  }
  return resolutions;
}

/**
 * The modes for one agent run: detection's resolutions when the run has them,
 * else a fresh read of the run's own directory (a composed or scoped run
 * settles its integration after detection), then the flag payloads applied.
 * Empty when the `wizard-sdk-capture-mode` gate is off.
 */
export async function settleSdkCaptureModes(
  session: {
    installDir: string;
    integration: Integration | null;
    sdkCaptureModes: readonly SdkCaptureModeResolution[];
  },
  snapshot: WizardFlagSnapshot,
): Promise<SdkCaptureModeResolution[]> {
  // The gate is the whole feature: off, a run resolves no mode and every
  // consumer (install tool, read-back, facts, probe, skill filter) stays idle.
  if (!isSdkCaptureModeEnabled(snapshot.flags)) return [];
  const flagPayloads = snapshot.payloads;
  const detected =
    session.sdkCaptureModes.length > 0 || !session.integration
      ? session.sdkCaptureModes
      : await detectSdkCaptureModes(session.installDir, session.integration);
  return applySdkCaptureModeFlags(
    { integration: session.integration, sdkCaptureModes: detected },
    flagPayloads,
  );
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
      floor: previous.mode === 'conflict' ? undefined : previous.floor,
    }),
  );
}

const MODE_LABEL = { legacy: 'legacy capture API', v1: 'capture v1 API' };

/** The capture v1 rules that hold in every SDK and need no syntax; the SDK's own rules carry the names. */
const V1_RULES =
  " On this line: send every `$ai_*` event through the SDK's AI capture method, never through `capture`; put per-event controls such as `process_person_profile` and `cookieless_mode` in the call's `options`, never as a `$`-prefixed property; a value set on the call beats a global, super or context value; a `before_send` hook must pass the event's `options` through unchanged.";

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
      }). Keep it; do not upgrade or downgrade it in this run.${
        resolution.mode === 'v1' ? V1_RULES : ''
      }`;
    }
    const why =
      resolution.reason === 'floor'
        ? ` The project does not meet the ${other} floor: ${resolution.detail}. Say so in the setup report; raising it and running the wizard again moves the project to ${other}.`
        : resolution.reason === 'host'
        ? ` The PostHog host does not serve the capture v1 routes.`
        : '';
    return `PostHog SDK ${row.sdk}: this run uses the ${line} line (${
      MODE_LABEL[resolution.mode]
    }).${why} Install ${line} only, never ${other}, with the exact command or declaration detect_package_manager returns; it overrides any install line in a skill or rule.${
      resolution.mode === 'v1' ? V1_RULES : ''
    }`;
  });
}
