/**
 * A program's screen flow in the TUI: the ordered screens, their visibility
 * and completion predicates, and the gates the TUI host waits on. Program
 * logic (detection, composed runs) stays on the program's `ProgramConfig`.
 */

import type { TuiView } from './tui-state.js';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type { ProgramId, WizardSession } from '@programs/types';

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

export interface FlowStep {
  /** Unique identifier for this step; `ProgramConfig.runSteps` keys match it. */
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
  show?: (view: TuiView) => boolean;

  /**
   * Exit condition for the screen. Router advances when true.
   * Defaults to `gate` if unset.
   */
  isComplete?: (view: TuiView) => boolean;

  /**
   * Define a gate if your screen needs to await user interactions.
   * The TUI host can `await store.getGate(stepId)` to pause until the
   * predicate becomes true.
   */
  gate?: (view: TuiView) => boolean;

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
   * sequences still follow the host. Matched by `screenId`.
   */
  reportsAsProgramId?: ProgramId;
}

/**
 * Project flow steps into the narrower Screen shape the router consumes:
 * steps without a screen are dropped, and each step narrows to
 * { id, show, isComplete }.
 */
export function createProgramSequence(steps: FlowStep[]): Array<{
  id: string;
  show?: (view: TuiView) => boolean;
  isComplete?: (view: TuiView) => boolean;
}> {
  const entries = steps
    .filter((step) => step.screenId != null)
    .map((step) => ({
      id: step.screenId!,
      show: step.show,
      isComplete: step.isComplete ?? step.gate,
    }));

  entries.push({ id: 'exit', show: undefined, isComplete: undefined });

  return entries;
}
