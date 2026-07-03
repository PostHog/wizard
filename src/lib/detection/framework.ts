/**
 * Framework detection — identify which PostHog-supported framework
 * is present in the project directory.
 *
 * Pure function: takes an install dir, returns the detected integration
 * (or undefined). No store mutations, no UI calls.
 */

import { Integration, DETECTION_TIMEOUT_MS } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';

/**
 * Loop through all registered frameworks and return the first one
 * whose `detect()` predicate matches the given directory.
 * Returns undefined if no framework is detected or detection times out.
 */
export async function detectFramework(
  installDir: string,
): Promise<Integration | undefined> {
  for (const integration of Object.values(Integration)) {
    const config = FRAMEWORK_REGISTRY[integration];
    try {
      const detected = await Promise.race([
        config.detection.detect({ installDir }),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), DETECTION_TIMEOUT_MS),
        ),
      ]);
      if (detected) {
        return integration;
      }
    } catch {
      // Skip frameworks whose detection throws
    }
  }
}
