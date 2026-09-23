/**
 * The TUI's program flows: each program's ordered screens, their gates and
 * completion predicates, and the helpers that project them for the router
 * and the runners. Pure leaf module: no store, no React.
 */

import type { ProgramId } from '@programs/types';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type { WizardSession } from './session';

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
 * One step of a program's journey in the TUI: a screen (or a screenless
 * gate), when it shows, when it is complete, what the runner waits on, and
 * any work that starts when the TUI does. Each program's steps live in
 * `./flows`.
 */
export interface FlowStep {
  /** Unique identifier for this step */
  id: string;

  /** Human-readable label for progress display */
  label: string;

  /**
   * TUI screen this step owns, if any.
   * Matches the ScreenId enum values (e.g. 'intro', 'run', 'outro').
   */
  screenId?: string;

  /**
   * Whether this step should be visible in the current program.
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
   * Called once when the TUI starts rendering, with the default
   * session. Use for session-independent fire-and-forget work that
   * should start as early as possible (e.g. health check kicked off
   * while the user is still reading the intro screen). Never fires for
   * a store that isn't rendering screens (tests, playground).
   */
  onInit?: (ctx: StoreInitContext) => void;

  /**
   * Report this step's analytics under a different program than its host, for
   * steps shared across programs (the MCP tutorial is all of `mcp-tutorial`
   * and the last step of `mcp-add`). Attribution only — scopes, bindings, and
   * sequences still follow the host. Matched by `screenId`, so headless steps
   * are unaffected.
   */
  reportsAsProgramId?: ProgramId;
}

/**
 * The gated steps the agent runner awaits after `auth` and before `run`, in
 * step order. Empty when a program has no auth step or runs before it.
 */
export function postAuthGateSteps(steps: FlowStep[]): FlowStep[] {
  const authIndex = steps.findIndex((s) => s.screenId === 'auth');
  const runIndex = steps.findIndex((s) => s.screenId === 'run');
  if (authIndex === -1 || runIndex <= authIndex) return [];
  return steps.slice(authIndex + 1, runIndex).filter((s) => s.gate);
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
export function createProgramSequence(steps: FlowStep[]): Array<{
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
