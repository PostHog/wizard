/**
 * InkUI — Ink-backed implementation of WizardUI.
 *
 * Translates business logic calls into store setter calls.
 * No direct session mutation. No imperative screen transitions.
 * The router derives the active screen from session state.
 */

import type { WizardUI, SpinnerHandle } from '../wizard-ui.js';
import type { WizardStore } from './store.js';
import type { SettingsConflict } from '../../lib/agent/agent-interface.js';
import type { WizardReadinessResult } from '../../lib/health-checks/readiness.js';
import type { OutroData } from '../../lib/wizard-session.js';
import { RunPhase, OutroKind } from '../../lib/wizard-session.js';

// Strip ANSI escape codes (chalk formatting) from strings
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export class InkUI implements WizardUI {
  constructor(private store: WizardStore) {}

  intro(message: string): void {
    this.store.pushStatus(message);
  }

  outro(message: string): void {
    this.store.pushStatus(stripAnsi(message));

    // agent-runner mutates session.outroData directly before calling outro().
    // Direct mutation doesn't notify nanostore subscribers, so re-set the
    // value through setOutroData() to push it to React. If there's no
    // pre-built outroData, fall back to a minimal success record.
    const existing = this.store.session.outroData;
    this.store.setOutroData(
      existing ?? {
        kind: OutroKind.Success,
        message: stripAnsi(message),
      },
    );

    // Signal that the main work is done — router resolves to mcp or outro
    if (this.store.session.runPhase === RunPhase.Running) {
      this.store.setRunPhase(RunPhase.Completed);
    }
  }

  outroError(data: OutroData): void {
    this.store.setOutroData(data);
    // Advance router past the run step so the outro screen renders
    if (this.store.session.runPhase !== RunPhase.Error) {
      this.store.setRunPhase(RunPhase.Error);
    }
  }

  waitForOutroDismissed(): Promise<void> {
    return new Promise((resolve) => {
      if (this.store.session.outroDismissed) {
        resolve();
        return;
      }
      const unsub = this.store.subscribe(() => {
        if (this.store.session.outroDismissed) {
          unsub();
          resolve();
        }
      });
    });
  }

  setCredentials(credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  }): void {
    this.store.setCredentials(credentials);
  }

  setDetectedFramework(label: string): void {
    this.store.setDetectedFramework(label);
  }

  onEnterScreen(screen: string, fn: () => void): void {
    this.store.onEnterScreen(
      screen as Parameters<WizardStore['onEnterScreen']>[0],
      fn,
    );
  }

  setLoginUrl(url: string | null): void {
    this.store.setLoginUrl(url);
  }

  showBlockingOutage(result: WizardReadinessResult): Promise<void> {
    // In the TUI, the HealthCheckScreen handles outage display.
    // This is only called from agent-runner for the CI fallback path.
    this.store.setReadinessResult(result);
    return Promise.resolve();
  }

  setReadinessWarnings(result: WizardReadinessResult): void {
    this.store.setReadinessResult(result);
  }

  showPortConflict(processInfo: {
    command: string;
    pid: string;
    port: number;
    user: string;
  }): Promise<void> {
    return this.store.showPortConflict(processInfo);
  }

  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    return this.store.showSettingsOverride(conflicts, backupAndFix);
  }

  showAuthError(): void {
    this.store.showAuthError();
  }

  startRun(): void {
    this.store.setRunPhase(RunPhase.Running);
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

  setEventPlan(events: Array<{ name: string; description: string }>): void {
    this.store.setEventPlan(events);
  }

  setFrameworkContext(key: string, value: unknown): void {
    this.store.setFrameworkContext(key, value);
  }
}
