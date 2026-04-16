import type { WizardSession, DiscoveredFeature } from '../wizard-session';
import type { WizardReadinessResult } from '../health-checks/readiness.js';
import type { WorkflowRun } from '../agent/agent-runner.js';
import type { Integration } from '../constants.js';
import type { FrameworkConfig } from '../framework-config.js';

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
 * Context passed to onInit callbacks — fires during store construction,
 * before bin.ts has assigned the real session.
 */
export interface StoreInitContext {
  readonly session: WizardSession;
  readonly setReadinessResult: (result: WizardReadinessResult | null) => void;
  readonly setFrameworkContext: (key: string, value: unknown) => void;
  readonly emitChange: () => void;
}

/**
 * Context passed to onReady callbacks — fires after bin.ts has assigned
 * the real session, so reading `session.installDir` returns the target
 * project. Use for async pre-flow work like prerequisite detection.
 */
export interface WorkflowReadyContext {
  readonly session: WizardSession;
  readonly setFrameworkContext: (key: string, value: unknown) => void;

  // Detection-specific methods — used by core-integration's detect step
  readonly setFrameworkConfig: (
    integration: Integration,
    config: FrameworkConfig,
  ) => void;
  readonly setDetectedFramework: (label: string) => void;
  readonly setUnsupportedVersion: (info: {
    current: string;
    minimum: string;
    docsUrl: string;
  }) => void;
  readonly addDiscoveredFeature: (feature: DiscoveredFeature) => void;
  readonly setDetectionComplete: () => void;
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
   * Called once during store construction, with the default session.
   * Use for session-independent fire-and-forget work that should start
   * as early as possible (e.g. health check kicked off while the user
   * is still reading the intro screen).
   */
  onInit?: (ctx: StoreInitContext) => void;

  /**
   * Called once after bin.ts has assigned the real session to the store,
   * before any gate is awaited. Awaited in sequence with other steps'
   * onReady callbacks. Use for session-dependent pre-flow work like
   * scanning the installDir for prerequisites. May be sync or async.
   */
  onReady?: (ctx: WorkflowReadyContext) => void | Promise<void>;
}

/**
 * An ordered list of workflow steps that defines a wizard flow.
 */
export type Workflow = WorkflowStep[];

/**
 * Uniform configuration for a wizard workflow.
 *
 * Each workflow directory exports one of these. The system uses it
 * for CLI registration, flow/step wiring, and skill bootstrap.
 */
export interface WorkflowConfig {
  /** CLI command name (e.g. 'revenue'). Omit for the default flow. */
  command?: string;
  /** CLI description shown in --help */
  description: string;
  /** Unique flow key — matches the Flow enum value */
  flowKey: string;
  /** The ordered step list */
  steps: Workflow;
  /** Agent run config. Static object or async function for dynamic config. */
  run?: WorkflowRun | ((session: WizardSession) => Promise<WorkflowRun>);
  /** Prerequisites: other workflow flowKeys that must have run first */
  requires?: string[];
}

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
