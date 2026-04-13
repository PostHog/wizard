import type { WizardSession } from './wizard-session';

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
  setReadinessResult(
    result: import('./health-checks/readiness.js').WizardReadinessResult | null,
  ): void;
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
   * Whether this step is complete.
   * The flow engine advances past complete steps.
   */
  isComplete?: (session: WizardSession) => boolean;

  /**
   * If present, creates a gate promise keyed by step.id on the store.
   * The promise resolves when this predicate returns true for the
   * current session state. Checked after every emitChange().
   * bin.ts awaits store.getGate(stepId) before proceeding to the runner.
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
 * Convert a Workflow into the FlowEntry shape the router expects.
 * This is the bridge between the new WorkflowStep model and the
 * existing router — lets us adopt WorkflowSteps without rewriting
 * the router.
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
      isComplete: step.isComplete,
    }));
}
