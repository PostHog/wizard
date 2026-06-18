/* eslint-disable no-console */
/**
 * LoggingUI — Logging-only implementation for CI mode.
 * No prompts, no TUI, no interactivity. Just console output.
 */

import {
  TaskStatus,
  type WizardUI,
  type SpinnerHandle,
  type AuthErrorDetail,
} from './wizard-ui';
import type { SettingsConflict } from '@lib/agent/claude-settings';
import type { ApiUser } from '@lib/api';
import { OAUTH_TIMEOUT_MS } from '@lib/constants';
import {
  type WizardReadinessResult,
  getBlockingServiceKeys,
  SERVICE_LABELS,
} from '@lib/health-checks/readiness';
import type {
  AskAnswers,
  OutroData,
  PendingQuestion,
} from '@lib/wizard-session';

export class LoggingUI implements WizardUI {
  intro(message: string): void {
    console.log(`┌  ${message}`);
  }

  outro(message: string): void {
    console.log(`└  ${message}`);
  }

  outroError(data: OutroData): void {
    console.log(`✖  ${data.message ?? 'Wizard aborted'}`);
    if (data.body) console.log(`│  ${data.body}`);
    if (data.docsUrl) console.log(`│  Docs: ${data.docsUrl}`);
  }

  waitForOutroDismissed(): Promise<void> {
    return Promise.resolve();
  }

  waitForAiOptIn(): Promise<void> {
    // Non-TUI runs are CI runs, which auto-consent to AI usage.
    return Promise.resolve();
  }

  cancel(message: string): void {
    console.log(`■  ${message}`);
  }

  log = {
    info(message: string): void {
      console.log(`│  ${message}`);
    },
    warn(message: string): void {
      console.log(`▲  ${message}`);
    },
    error(message: string): void {
      console.log(`✖  ${message}`);
    },
    success(message: string): void {
      console.log(`✔  ${message}`);
    },
    step(message: string): void {
      console.log(`◇  ${message}`);
    },
  };

  note(message: string): void {
    console.log(`│  ${message}`);
  }

  spinner(): SpinnerHandle {
    return {
      start(message?: string) {
        if (message) console.log(`◌  ${message}`);
      },
      stop(message?: string) {
        if (message) console.log(`●  ${message}`);
      },
      message(msg?: string) {
        if (msg) console.log(`◌  ${msg}`);
      },
    };
  }

  pushStatus(message: string): void {
    console.log(`◇  ${message}`);
  }

  setDetectedFramework(label: string): void {
    console.log(`✔  Framework: ${label}`);
  }

  onEnterScreen(_screen: string, _fn: () => void): void {
    // No screen transitions in CI
  }

  setLoginUrl(url: string | null): void {
    if (url) {
      console.log(
        `│  If the browser didn't open automatically, use this link:`,
      );
      console.log(`│  ${url}`);
    }
  }

  setAuthorizeUrl(_url: string | null): void {
    // Manual-paste modal is TUI-only; CI/non-interactive runs don't use it.
  }

  showBlockingOutage(result: WizardReadinessResult): Promise<void> {
    console.log(`▲  Service health issues detected — blocking outage.`);
    const blockingKeys = getBlockingServiceKeys(result.health);
    if (blockingKeys.length > 0) {
      console.log(`│`);
      console.log(`│  Blocking services:`);
      for (const key of blockingKeys) {
        const status = result.health[key].status;
        const error = result.health[key].error;
        const label = SERVICE_LABELS[key];
        const detail = error ? ` — ${error}` : '';
        console.log(`│    ✖ ${label}: ${status}${detail}`);
      }
      console.log(`│`);
    }
    for (const reason of result.reasons) {
      console.log(`│  ${reason}`);
    }
    console.log(`│  The wizard cannot start while these services are down.`);
    return Promise.resolve();
  }

  setReadinessWarnings(result: WizardReadinessResult): void {
    console.log(`▲  Service health warnings detected.`);
    for (const reason of result.reasons) {
      console.log(`│  ${reason}`);
    }
  }

  showPortConflict(_processInfo: {
    command: string;
    pid: string;
    port: number;
    user: string;
  }): Promise<void> {
    return Promise.resolve();
  }

  waitForManualAuthCode(): Promise<string> {
    // No interactive prompt in CI/logging mode — never resolves. CI bypasses
    // OAuth entirely, so this is only here to satisfy the interface.
    return new Promise<string>(() => {
      /* intentionally never resolves */
    });
  }

  showSettingsOverride(
    _conflicts: SettingsConflict[],
    _backupAndFix: () => boolean,
  ): Promise<void> {
    return Promise.resolve();
  }

  requestQuestion(_question: PendingQuestion): Promise<AskAnswers> {
    return Promise.reject(
      new Error(
        'wizard_ask is not available in CI / non-interactive mode. ' +
          'Re-run the wizard without --ci to answer interactively.',
      ),
    );
  }

  showAuthError(detail?: AuthErrorDetail): void {
    console.log(`✖  Authentication failed (401)`);
    if (detail?.hasSettingsConflict) {
      console.log(
        `│  Claude Code auth is conflicting with the wizard. Please try again after logging out:`,
      );
      console.log(`│    claude auth logout`);
    } else {
      console.log(
        `│  The PostHog LLM Gateway rejected the API key. Common causes:`,
      );
      console.log(
        `│    - Wrong key type: pass a personal API key (phx_xxx). pha_ is an OAuth access token, phc_ is a project key.`,
      );
      console.log(
        `│    - Missing scope: the personal API key needs the "llm_gateway:read" scope.`,
      );
      console.log(`│    - Expired or revoked key.`);
      console.log(
        `│    - Region mismatch: --region must match the region the key was issued in (us vs eu).`,
      );
    }
    if (detail?.logFilePath) {
      console.log(`│  Verbose log: ${detail.logFilePath}`);
    }
  }

  showSessionTimeout(): void {
    const minutes = Math.round(OAUTH_TIMEOUT_MS / 60_000);
    console.log(
      `✖  Login timed out. The OAuth link timed out after ${minutes} minutes.`,
    );
    console.log(`│  Re-run the wizard to get a fresh link and try again.`);
  }

  startRun(): void {
    // No-op in CI mode
  }

  setCredentials(_credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  }): void {
    // No-op in CI mode — credentials are handled directly
  }

  setRoleAtOrganization(_role: string | null): void {
    // No-op in CI mode — there's no TUI to render role-tailored prompts
  }

  setApiUser(_user: ApiUser | null): void {
    // No-op in CI mode — there's no TUI to read account context from
    // the session.
  }

  private lastTodoLine = '';

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const completed = todos.filter(
      (t) => t.status === TaskStatus.Completed,
    ).length;
    const active = todos.filter((t) => t.status === TaskStatus.InProgress);
    if (active.length === 0) return;
    const labels = active.map((t) => t.activeForm || t.content).join(' · ');
    const line = `◌  [${completed}/${todos.length}] ${labels}`;
    // The queue re-renders on every transition; print only what changed.
    if (line === this.lastTodoLine) return;
    this.lastTodoLine = line;
    console.log(line);
  }

  setEventPlan(_events: Array<{ name: string; description: string }>): void {
    // No-op in CI mode
  }

  setDashboardUrl(_url: string): void {
    // No-op in CI mode
  }

  setNotebookUrl(_url: string): void {
    // No-op in CI mode
  }

  setOutroData(_data: import('@lib/wizard-session').OutroData): void {
    // No-op in CI mode
  }

  setFrameworkContext(_key: string, _value: unknown): void {
    // No-op in CI mode
  }
}
