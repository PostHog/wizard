import type { WizardSession } from './wizard-session';
import type { WizardReadinessResult } from './health-checks/readiness.js';

/**
 * A workflow step is the primary unit of the wizard's execution model.
 *
 * It can own:
 * - a screen in the TUI (optional — some steps are headless)
 * - agent work via a workflow reference (optional — some steps are UI-only)
 * - completion and visibility predicates
 *
 * The current PostHog integration flow is one ordered list of steps.
 * Future flows (e.g. revenue analytics) register a different step list.
 */
/**
 * Minimal interface passed to onInit callbacks.
 * Avoids circular dependency with WizardStore while giving steps
 * enough access to kick off async work (e.g. health checks).
 */
export interface StoreInitContext {
  get session(): WizardSession;
  setReadinessResult(result: WizardReadinessResult | null): void;
  setFrameworkContext(key: string, value: unknown): void;
  emitChange(): void;
}

export interface WorkflowStep {
  /** Unique identifier for this step */
  id: string;

  /** Human-readable label for progress display */
  label: string;

  /**
   * TUI screen this step owns, if any.
   * Matches the Screen enum values (e.g. 'intro', 'run', 'outro').
   */
  screen?: string;

  /**
   * Whether this step should be visible in the current flow.
   * If omitted, the step is always visible.
   */
  show?: (session: WizardSession) => boolean;

  /**
   * Exit condition for the screen. Router advances when true.
   * Defaults to `gate` if unset.
   */
  isComplete?: (session: WizardSession) => boolean;

  /**
   * Define a gate if your screen needs to await user interactions.
   * bin.ts can `await store.getGate(stepId)` to pause until the
   * predicate becomes true.
   */
  gate?: (session: WizardSession) => boolean;

  /**
   * Called once during store construction. For steps that need to kick
   * off async work early (e.g. health checks that run while the user
   * is still on the intro screen).
   */
  onInit?: (ctx: StoreInitContext) => void;
}

/**
 * An ordered list of workflow steps that defines a wizard flow.
 */
export type Workflow = WorkflowStep[];

/**
 * Project a Workflow into the narrower FlowEntry shape the router consumes.
 *
 * Two things happen here:
 *   1. Headless steps (no `screen`) are filtered out. The router walks
 *      visible screens; gate-only steps like `detect` are store concerns.
 *   2. The step is narrowed to just { screen, show, isComplete } — the
 *      router has no business touching gate, onInit, id, or label.
 *
 * This intentional separation keeps the router focused on one question:
 * "Which screen should be rendered right now?"
 */
export function workflowToFlowEntries(workflow: Workflow): Array<{
  screen: string;
  show?: (session: WizardSession) => boolean;
  isComplete?: (session: WizardSession) => boolean;
}> {
  return workflow
    .filter((step) => step.screen != null)
    .map((step) => ({
      screen: step.screen!,
      show: step.show,
      // `isComplete` defaults to `gate` — for most steps they're the same
      // predicate (e.g. intro: setupConfirmed unblocks bin.ts AND finishes
      // the screen). Only override when the two conditions diverge.
      isComplete: step.isComplete ?? step.gate,
    }));
}
