/**
 * Framework context gathering — run gatherContext and version checks
 * for a detected framework.
 *
 * Pure functions: take a framework config and options, return results.
 * No store mutations, no UI calls.
 */

import * as semver from 'semver';
import { DETECTION_TIMEOUT_MS } from '@lib/constants';
import type { FrameworkConfig } from '@lib/framework-config';
import type { WizardRunOptions } from '@utils/types';

/**
 * Run a framework's `gatherContext()` to collect variant-specific
 * metadata (e.g., router type for Next.js, Expo vs bare for React Native).
 *
 * Returns the gathered context, or an empty object on failure/timeout.
 */
export async function gatherFrameworkContext(
  config: FrameworkConfig,
  options: WizardRunOptions,
): Promise<Record<string, unknown>> {
  if (!config.metadata.gatherContext) return {};

  try {
    return await Promise.race([
      config.metadata.gatherContext(options),
      new Promise<Record<string, never>>((resolve) =>
        setTimeout(() => resolve({}), DETECTION_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return {};
  }
}

export interface VersionCheckResult {
  /** Whether the installed version is supported */
  supported:
    | true
    | {
        current: string;
        minimum: string;
        docsUrl: string;
      };
}

/**
 * Check whether the installed framework version meets the minimum requirement.
 *
 * Returns `{ supported: true }` if the version is fine (or no check is needed).
 * Returns the version details if unsupported.
 */
export async function checkFrameworkVersion(
  config: FrameworkConfig,
  options: WizardRunOptions,
): Promise<VersionCheckResult> {
  if (
    !config.detection.minimumVersion ||
    !config.detection.getInstalledVersion
  ) {
    return { supported: true };
  }

  const version = await config.detection.getInstalledVersion(options);
  if (!version) return { supported: true };

  const coerced = semver.coerce(version);
  if (coerced && semver.lt(coerced, config.detection.minimumVersion)) {
    return {
      supported: {
        current: version,
        minimum: config.detection.minimumVersion,
        docsUrl:
          config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl,
      },
    };
  }

  return { supported: true };
}
