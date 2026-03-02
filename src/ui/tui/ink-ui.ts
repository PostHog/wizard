/**
 * InkUI — Ink-backed implementation of WizardUI.
 *
 * No prompt methods — screens own all user input.
 * Run phase is headless.
 */

import type { WizardUI, SpinnerHandle } from '../wizard-ui.js';
import type { WizardStore } from './store.js';

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
        kind: 'success',
        message: stripAnsi(message),
      });
    }
    // The flow will advance through mcp → outro via store.advance()
    // from the RunScreen/McpScreen. No need to jump here.
  }

  setLoginUrl(_url: string | null): void {
    // No-op — IntroScreen could display this if needed
  }

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    this.store.session.serviceStatus = data;
    this.store.pushOverlay('outage');
  }

  startRun(): void {
    this.store.startFlow('run');
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
