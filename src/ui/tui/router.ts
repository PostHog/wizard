/**
 * WizardRouter — declarative program pipelines + overlay stack.
 *
 * Two layers:
 *   Program cursor — linear sequence of screens, advanced with next()
 *   Overlay stack  — interrupts (outage, auth-expired, etc.) that push/pop
 *
 * The visible screen is: top of overlay stack if non-empty, otherwise the program cursor.
 *
 * Adding a program screen = append to a sequence array.
 * Adding an overlay = call pushOverlay() from anywhere.
 * No switch statements, no hardcoded transitions in business logic.
 */

import type { WizardSession } from '@lib/wizard-session';
import { Program, type ProgramId } from '@lib/programs/program-registry';
import {
  PROGRAM_SEQUENCES,
  ScreenId,
  type Screen,
  type Sequence,
} from './screen-sequences.js';

// Re-export so existing imports from './router.js' keep working
export { ScreenId, Program };
export type { Screen, Sequence, ProgramId };

// ── ScreenId name taxonomy ──────────────────────────────────────────────

/** Screens that interrupt programs as overlays */
export enum Overlay {
  SettingsOverride = 'settings-override',
  ManagedSettings = 'managed-settings',
  PortConflict = 'port-conflict',
  AuthError = 'auth-error',
  WizardAsk = 'wizard-ask',
}

/** Union of all screen names */
export type ScreenName = ScreenId | Overlay;

// ── Router ────────────────────────────────────────────────────────────

export class WizardRouter {
  private sequence: Sequence;
  private programId: ProgramId;
  private overlays: Overlay[] = [];

  constructor(programId: ProgramId = Program.PostHogIntegration) {
    this.programId = programId;
    this.sequence = PROGRAM_SEQUENCES[programId];
  }

  /**
   * Resolve which screen should be active based on session state.
   * Walks the program sequence, skipping hidden entries and completed entries,
   * returns the first incomplete screen.
   */
  resolve(session: WizardSession): ScreenName {
    if (this.overlays.length > 0) {
      return this.overlays[this.overlays.length - 1];
    }

    for (const entry of this.sequence) {
      if (entry.show && !entry.show(session)) continue;
      if (entry.isComplete && entry.isComplete(session)) continue;
      return entry.id;
    }

    // All entries complete — show the last screen (outro)
    return this.sequence[this.sequence.length - 1].id;
  }

  /** The screen that should be rendered right now. */
  get activeScreen(): ScreenName {
    // Overlays take priority — resolve() handles this too,
    // but activeScreen is called before session is available in some paths
    if (this.overlays.length > 0) {
      return this.overlays[this.overlays.length - 1];
    }
    return this.sequence[0].id;
  }

  /** The id of the active program. */
  get activeProgram(): ProgramId {
    return this.programId;
  }

  /** Whether an overlay is currently active. */
  get hasOverlay(): boolean {
    return this.overlays.length > 0;
  }

  /**
   * Push an overlay that interrupts the current program.
   * The program resumes when the overlay is dismissed via popOverlay().
   */
  pushOverlay(overlay: Overlay): void {
    this.overlays.push(overlay);
  }

  /**
   * Dismiss the topmost overlay. The program screen underneath resumes.
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
