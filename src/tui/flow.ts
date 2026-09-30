import type { WizardSession } from '@programs/session/wizard-session';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type { ProgramStep } from '@programs/program-step';

/**
 * Context passed to onInit callbacks — fires when the TUI starts
 * rendering, before bin.ts has assigned the real session.
 */
export interface StoreInitContext {
  readonly session: WizardSession;
  readonly setReadinessResult: (result: WizardReadinessResult | null) => void;
  readonly setFrameworkContext: (key: string, value: unknown) => void;
  readonly emitChange: () => void;
}

/**
 * Project program steps into the narrower Screen shape the router consumes.
 *
 * Two things happen here:
 *   1. Headless steps (no `screenId`) are filtered out. The router walks
 *      visible screens; gate-only steps like `detect` are store concerns.
 *   2. The step is narrowed to just { id, show, isComplete } — the
 *      router has no business touching gate, onInit, or label.
 *
 * This intentional separation keeps the router focused on one question:
 * "Which screen should be rendered right now?"
 */

export function createProgramSequence(steps: ProgramStep[]): Array<{
  id: string;
  show?: (session: WizardSession) => boolean;
  isComplete?: (session: WizardSession) => boolean;
}> {
  const entries = steps
    .filter((step) => step.screenId != null)
    .map((step) => ({
      id: step.screenId!,
      show: step.show,
      // `isComplete` defaults to `gate` — for most steps they're the same
      // predicate (e.g. intro: setupConfirmed unblocks bin.ts AND finishes
      // the screen). Only override when the two conditions diverge.
      isComplete: step.isComplete ?? step.gate,
    }));

  // Every program ends with the exit screen.
  entries.push({ id: 'exit', show: undefined, isComplete: undefined });

  return entries;
}
