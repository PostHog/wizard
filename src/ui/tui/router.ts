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
import { FLOWS, Screen, Flow, type FlowEntry } from './flows.js';

// Re-export so existing imports from './router.js' keep working
export { Screen, Flow };
export type { FlowEntry };

// ── Screen name taxonomy ──────────────────────────────────────────────

/** Screens that interrupt flows as overlays */
export enum Overlay {
  SettingsOverride = 'settings-override',
  PortConflict = 'port-conflict',
}

/** Union of all screen names */
export type ScreenName = Screen | Overlay;

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
