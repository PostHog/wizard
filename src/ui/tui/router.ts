/**
 * WizardRouter — declarative flow pipelines + overlay stack.
 *
 * Two layers:
 *   Flow cursor    — linear pipeline of screens, advanced with next()
 *   Overlay stack  — interrupts (outage, auth-expired, etc.) that push/pop
 *
 * The visible screen is: top of overlay stack if non-empty, otherwise the flow cursor.
 *
 * Adding a flow screen = append to a pipeline array.
 * Adding an overlay = call pushOverlay() from anywhere.
 * No switch statements, no hardcoded transitions in business logic.
 */

import { type WizardSession, RunPhase } from '../../lib/wizard-session.js';

// ── Screen name taxonomy ──────────────────────────────────────────────

/** Screens that participate in linear flows */
export enum Screen {
  Intro = 'intro',
  Setup = 'setup',
  Auth = 'auth',
  Run = 'run',
  Mcp = 'mcp',
  Outro = 'outro',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
}

/** Screens that interrupt flows as overlays */
export enum Overlay {
  Outage = 'outage',
}

/** Union of all screen names */
export type ScreenName = Screen | Overlay;

/** Named flows the router can run */
export enum Flow {
  Wizard = 'wizard',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
}

// ── Flow definitions ──────────────────────────────────────────────────

export interface FlowEntry {
  /** Screen to show */
  screen: Screen;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (session: WizardSession) => boolean;
  /** If provided, screen is considered complete when this returns true. */
  isComplete?: (session: WizardSession) => boolean;
}

/**
 * Check if the SetupScreen is needed (unresolved framework questions).
 */
function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

/** All flow pipelines. Add new screens by appending entries. */
const FLOWS: Record<Flow, FlowEntry[]> = {
  [Flow.Wizard]: [
    {
      screen: Screen.Intro,
      isComplete: (s) => s.setupConfirmed,
    },
    {
      screen: Screen.Setup,
      show: needsSetup,
      isComplete: (s) => !needsSetup(s),
    },
    {
      screen: Screen.Auth,
      isComplete: (s) => s.credentials !== null,
    },
    {
      screen: Screen.Run,
      isComplete: (s) =>
        s.runPhase === RunPhase.Completed || s.runPhase === RunPhase.Error,
    },
    {
      screen: Screen.Mcp,
      isComplete: (s) => s.mcpComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.McpAdd]: [
    {
      screen: Screen.McpAdd,
      isComplete: (s) => s.runPhase === RunPhase.Completed,
    },
    { screen: Screen.Outro },
  ],

  [Flow.McpRemove]: [
    {
      screen: Screen.McpRemove,
      isComplete: (s) => s.runPhase === RunPhase.Completed,
    },
    { screen: Screen.Outro },
  ],
};

// ── Router ────────────────────────────────────────────────────────────

export class WizardRouter {
  private flow: FlowEntry[];
  private flowName: Flow;
  private overlays: Overlay[] = [];

  constructor(flowName: Flow = Flow.Wizard) {
    this.flowName = flowName;
    this.flow = FLOWS[flowName];
  }

  /**
   * Resolve which screen should be active based on session state.
   * Walks the flow pipeline, skipping hidden entries and completed entries,
   * returns the first incomplete screen.
   */
  resolve(session: WizardSession): ScreenName {
    if (this.overlays.length > 0) {
      return this.overlays[this.overlays.length - 1];
    }

    for (const entry of this.flow) {
      if (entry.show && !entry.show(session)) continue;
      if (entry.isComplete && entry.isComplete(session)) continue;
      return entry.screen;
    }

    // All entries complete — show the last screen (outro)
    return this.flow[this.flow.length - 1].screen;
  }

  /** The screen that should be rendered right now. */
  get activeScreen(): ScreenName {
    // Overlays take priority — resolve() handles this too,
    // but activeScreen is called before session is available in some paths
    if (this.overlays.length > 0) {
      return this.overlays[this.overlays.length - 1];
    }
    return this.flow[0].screen;
  }

  /** The name of the active flow. */
  get activeFlow(): Flow {
    return this.flowName;
  }

  /** Whether an overlay is currently active. */
  get hasOverlay(): boolean {
    return this.overlays.length > 0;
  }

  /**
   * Push an overlay that interrupts the current flow.
   * The flow resumes when the overlay is dismissed via popOverlay().
   */
  pushOverlay(overlay: Overlay): void {
    this.overlays.push(overlay);
  }

  /**
   * Dismiss the topmost overlay. The flow screen underneath resumes.
   */
  popOverlay(): void {
    this.overlays.pop();
  }

  /**
   * Direction hint for screen transitions.
   */
  private _lastDirection: 'push' | 'pop' | null = null;

  get lastNavDirection(): 'push' | 'pop' | null {
    return this._lastDirection;
  }

  /** @internal — called by store wrapper to track direction */
  _setDirection(dir: 'push' | 'pop' | null): void {
    this._lastDirection = dir;
  }
}
