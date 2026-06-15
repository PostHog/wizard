/**
 * Promotable-program discovery — the producer side of post-install
 * discoverability.
 *
 * A program opts in by declaring `promotable` on its config (see
 * `ProgramConfig.promotable`). This module answers one product-agnostic
 * question: given what the `detect` step found, which registered programs
 * should we recommend? The "Recommended next" screen and its `show` predicate
 * are the only callers — they hold no product knowledge, they just iterate.
 *
 * The user's picks land in `session.recommendedFollowUps`, which is the seam a
 * future orchestrator/queue consumes. Today the seam is rendered as copy-paste
 * `npx` commands on exit (see `exit-line.ts`).
 */

import type { WizardSession } from '@lib/wizard-session';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import type { ProgramConfig } from '@lib/programs/program-step';

/** Registered programs whose `promotable.feature` was detected on the project. */
export function getPromotableRecommendations(
  session: WizardSession,
): ProgramConfig[] {
  return PROGRAM_REGISTRY.filter(
    (config) =>
      config.promotable != null &&
      session.discoveredFeatures.includes(config.promotable.feature),
  );
}
