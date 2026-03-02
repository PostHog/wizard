/**
 * InkUI — Ink-backed implementation of WizardUI.
 *
 * No prompt methods — screens own all user input.
 * Navigation is reactive — InkUI sets session state, the router resolves the screen.
 */

import type { WizardUI, SpinnerHandle } from '../wizard-ui.js';
import type { WizardStore } from './store.js';
import { Overlay } from './router.js';
import { RunPhase, OutroKind } from '../../lib/wizard-session.js';

// Strip ANSI escape codes (chalk formatting) from strings
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export class InkUI implements WizardUI {
  constructor(private store: WizardStore) {}

  // --- Lifecycle ---

  setSetupData(_data: {
    wizardLabel?: string;
    detectedFramework?: string;
    betaNotice?: string;
    preRunNotice?: string;
    disclosure?: string;
  }): void {
    // IntroScreen owns intro display — no-op
  }

  intro(message: string): void {
    this.store.pushStatus(message);
  }

  outro(message: string): void {
    this.store.pushStatus(stripAnsi(message));

    if (!this.store.session.outroData) {
      this.store.setOutroData({
        kind: OutroKind.Success,
        message: stripAnsi(message),
      });
    }

    // Set phase to completed — the router will resolve to mcp or outro
    if (this.store.session.runPhase === RunPhase.Running) {
      this.store.session.runPhase = RunPhase.Completed;
    }
    this.store.emitChange();
  }

  setLoginUrl(_url: string | null): void {
    // No-op — IntroScreen could display this if needed
  }

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    this.store.session.serviceStatus = data;
    this.store.pushOverlay(Overlay.Outage);
  }

  startRun(): void {
    this.store.session.runPhase = RunPhase.Running;
    this.store.emitChange();
  }

  cancel(message: string): void {
    this.store.pushStatus(message);
  }

  log = {
    info: (message: string): void => {
      this.store.pushStatus(message);
    },
    warn: (message: string): void => {
      this.store.pushStatus(message);
    },
    error: (message: string): void => {
      this.store.pushStatus(message);
    },
    success: (message: string): void => {
      this.store.pushStatus(message);
    },
    step: (message: string): void => {
      this.store.pushStatus(message);
    },
  };

  note(message: string): void {
    this.store.pushStatus(message);
  }

  spinner(): SpinnerHandle {
    return {
      start: (message?: string) => {
        if (message) this.store.pushStatus(message);
      },
      stop: (message?: string) => {
        if (message) this.store.pushStatus(message);
      },
      message: (msg?: string) => {
        if (msg) this.store.pushStatus(msg);
      },
    };
  }

  pushStatus(message: string): void {
    this.store.pushStatus(message);
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    this.store.syncTodos(todos);
  }
}
