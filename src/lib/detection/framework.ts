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
    // Abort the detector's filesystem walk on timeout. Without this the
    // Promise.race below just stops awaiting a slow detector — the glob keeps
    // walking and buffering in the background, which on huge repos climbs until
    // the heap dies. Aborting stops the walk instead of leaking it.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS);
    try {
      const detected = await Promise.race([
        config.detection.detect({ installDir, signal: controller.signal }),
        new Promise<false>((resolve) => {
          if (controller.signal.aborted) {
            resolve(false);
            return;
          }
          controller.signal.addEventListener('abort', () => resolve(false), {
            once: true,
          });
        }),
      ]);
      if (detected) {
        return integration;
      }
    } catch {
      // Skip frameworks whose detection throws
    } finally {
      clearTimeout(timeout);
      // Stop any still-running walk before moving to the next framework
      // (covers both the timeout and the detected-early paths).
      controller.abort();
    }
  }
}
