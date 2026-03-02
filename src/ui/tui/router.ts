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

import type { WizardSession } from '../../lib/wizard-session.js';

// ── Screen name taxonomy ──────────────────────────────────────────────

/** Screens that participate in linear flows */
export type FlowScreen =
  | 'intro'
  | 'setup'
  | 'run'
  | 'mcp'
  | 'outro'
  | 'mcp-add'
  | 'mcp-remove';

/** Screens that interrupt flows as overlays */
export type OverlayScreen = 'outage';

/** Union of all screen names */
export type ScreenName = FlowScreen | OverlayScreen;

// ── Flow definitions ──────────────────────────────────────────────────

export interface FlowEntry {
  /** Screen to show */
  screen: FlowScreen;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (session: WizardSession) => boolean;
}

export type FlowName = 'wizard' | 'mcp-add' | 'mcp-remove';

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
const FLOWS: Record<FlowName, FlowEntry[]> = {
  wizard: [
    { screen: 'intro' },
    { screen: 'setup', show: needsSetup },
    { screen: 'run' },
    { screen: 'mcp' },
    { screen: 'outro' },
  ],

  'mcp-add': [{ screen: 'mcp-add' }, { screen: 'outro' }],

  'mcp-remove': [{ screen: 'mcp-remove' }, { screen: 'outro' }],
};

// ── Router ────────────────────────────────────────────────────────────

export class WizardRouter {
  private flow: FlowEntry[];
  private flowName: FlowName;
  private cursor = 0;
  private overlays: OverlayScreen[] = [];

  constructor(flowName: FlowName = 'wizard') {
    this.flowName = flowName;
    this.flow = FLOWS[flowName];
  }

  /** The screen that should be rendered right now. */
  get activeScreen(): ScreenName {
    if (this.overlays.length > 0) {
      return this.overlays[this.overlays.length - 1];
    }
    return this.flow[this.cursor].screen;
  }

  /** The name of the active flow. */
  get activeFlow(): FlowName {
    return this.flowName;
  }

  /** Whether an overlay is currently active. */
  get hasOverlay(): boolean {
    return this.overlays.length > 0;
  }

  /** The current flow screen (ignoring overlays). */
  get currentFlowScreen(): FlowScreen {
    return this.flow[this.cursor].screen;
  }

  /**
   * Advance to the next flow screen, skipping any where show() returns false.
   * Returns the new active screen, or null if the flow is complete.
   */
  advance(session: WizardSession): ScreenName | null {
    let next = this.cursor + 1;

    while (next < this.flow.length) {
      const entry = this.flow[next];
      if (!entry.show || entry.show(session)) {
        this.cursor = next;
        return this.activeScreen;
      }
      next++;
    }

    // Flow complete
    return null;
  }

  /**
   * Push an overlay that interrupts the current flow.
   * The flow resumes when the overlay is dismissed via popOverlay().
   */
  pushOverlay(screen: OverlayScreen): void {
    this.overlays.push(screen);
  }

  /**
   * Dismiss the topmost overlay. The flow screen underneath resumes.
   */
  popOverlay(): void {
    this.overlays.pop();
  }

  /**
   * Jump the flow cursor to a specific screen.
   * Use sparingly — prefer advance() for normal flow progression.
   * Needed for error recovery (e.g., error boundary → outro).
   */
  jumpTo(screen: FlowScreen): void {
    const idx = this.flow.findIndex((e) => e.screen === screen);
    if (idx !== -1) {
      this.cursor = idx;
    }
  }

  /** Whether the flow has reached its terminal screen. */
  get isComplete(): boolean {
    return this.cursor >= this.flow.length - 1;
  }

  /**
   * Direction hint for screen transitions.
   * Overlays always push (slide in), popOverlay pops (slide out).
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
