/**
 * Wraps a framework's package-manager detector so `detect_package_manager`
 * also answers "and install the PostHog SDK with exactly this": the pinned
 * command for the run's capture mode, or the instruction to leave an installed
 * copy alone. Both agent flows call the tool before installing, so this is the
 * one channel that reaches them all.
 */
import type { Integration } from '@shared/constants';
import type { SdkCaptureModeResolution } from '@shared/sdk-capture-mode';
import {
  renderSdkInstall,
  type SdkInstallInstruction,
} from '@shared/sdk-install-commands';
import { getSdkMajorRow } from '@shared/sdk-majors';
import type {
  PackageManagerDetector,
  PackageManagerInfo,
} from '@utils/package-manager';

export interface SdkInstallSession {
  readonly integration: Integration | null;
  readonly sdkCaptureModes: readonly SdkCaptureModeResolution[];
  readonly frameworkContext: Readonly<Record<string, unknown>>;
}

/** Appended to the detector's recommendation, one sentence per SDK. */
export function sdkInstallRecommendation(
  resolution: SdkCaptureModeResolution,
  instruction: SdkInstallInstruction | undefined,
): string {
  const { sdk } = resolution;
  if (resolution.mode === 'conflict') {
    return `PostHog SDK ${sdk}: the project has copies on different major lines; do not install, upgrade or remove any of them.`;
  }
  if (resolution.reason === 'installed') {
    const copy = resolution.installed[0];
    return `PostHog SDK ${sdk}: ${copy.version} is already installed (${copy.source}); do not install, upgrade or downgrade it.`;
  }
  const how = instruction?.command
    ? `run exactly \`${instruction.command}\``
    : `declare exactly: ${instruction?.manifest ?? ''}`;
  return `PostHog SDK ${sdk}: ${how} (the ${resolution.major}.x line this run uses). Never install it by bare name or change the major.`;
}

export function withSdkInstallInstructions(
  detector: PackageManagerDetector,
  session: SdkInstallSession,
): PackageManagerDetector {
  if (session.sdkCaptureModes.length === 0) return detector;
  return async (installDir: string): Promise<PackageManagerInfo> => {
    const info = await detector(installDir);
    const sdkInstalls: SdkInstallInstruction[] = [];
    const sentences: string[] = [];
    for (const resolution of session.sdkCaptureModes) {
      let instruction: SdkInstallInstruction | undefined;
      if (resolution.mode !== 'conflict' && resolution.reason !== 'installed') {
        instruction = renderSdkInstall(
          getSdkMajorRow(resolution.sdk),
          resolution.mode,
          info.primary?.installCommand ?? '',
          { rustBlocking: session.frameworkContext.asyncRuntime === false },
        );
        sdkInstalls.push(instruction);
      }
      sentences.push(sdkInstallRecommendation(resolution, instruction));
    }
    return {
      ...info,
      recommendation: [info.recommendation, ...sentences].join(' '),
      sdkInstalls,
    };
  };
}
