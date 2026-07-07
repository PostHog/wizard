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
 * Language fallbacks, tried ONLY after every real framework has failed to
 * match — their predicates are broad (any package.json, any .py project), so
 * running them earlier would shadow specific frameworks. Order within the
 * phase matters too: `javascript_web` (lockfile + a frontend signal) is more
 * specific than `javascriptNode` (any package.json at all), so web is tried
 * first and generic Node is the last resort of the entire detection.
 */
const LANGUAGE_FALLBACKS: readonly Integration[] = [
  Integration.python,
  Integration.ruby,
  Integration.javascript_web,
  Integration.javascriptNode,
];

/**
 * The full detection order: every framework (enum order), then the language
 * fallbacks. Built explicitly rather than trusting enum declaration order,
 * so adding an Integration in the wrong place can't silently put a broad
 * fallback ahead of a specific framework. Exported for the ordering tests.
 */
export const DETECTION_ORDER: readonly Integration[] = [
  ...Object.values(Integration).filter(
    (integration) => !LANGUAGE_FALLBACKS.includes(integration),
  ),
  ...LANGUAGE_FALLBACKS,
];

/**
 * Return the first integration in DETECTION_ORDER whose `detect()` predicate
 * matches the given directory: real frameworks first, language fallbacks
 * after, generic Node last of all. Returns undefined if nothing matches or
 * detection times out.
 */
export async function detectFramework(
  installDir: string,
): Promise<Integration | undefined> {
  for (const integration of DETECTION_ORDER) {
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
