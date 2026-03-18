/* eslint-disable no-console */
/**
 * LoggingUI — Logging-only implementation for CI mode.
 * No prompts, no TUI, no interactivity. Just console output.
 */

import { TaskStatus, type WizardUI, type SpinnerHandle } from './wizard-ui';

export class LoggingUI implements WizardUI {
  intro(message: string): void {
    console.log(`┌  ${message}`);
  }

  outro(message: string): void {
    console.log(`└  ${message}`);
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

  showBlockingOutage(
    result: import('../lib/health-checks/readiness.js').WizardReadinessResult,
  ): Promise<void> {
    console.log(`▲  Service health issues detected — blocking outage.`);
    for (const reason of result.reasons) {
      console.log(`│  ${reason}`);
    }
    console.log(
      `│  The wizard may not work reliably while services are affected.`,
    );
    return Promise.resolve();
  }

  setReadinessWarnings(
    result: import('../lib/health-checks/readiness.js').WizardReadinessResult,
  ): void {
    console.log(`▲  Service health warnings detected.`);
    for (const reason of result.reasons) {
      console.log(`│  ${reason}`);
    }
  }

  showPortConflict(_processInfo: {
    command: string;
    pid: string;
    user: string;
  }): Promise<void> {
    return Promise.resolve();
  }

  showSettingsOverride(
    keys: string[],
    _backupAndFix: () => boolean,
  ): Promise<void> {
    console.log(
      `▲  Security warning: .claude/settings.json overrides detected`,
    );
    for (const key of keys) {
      console.log(`│    • ${key}`);
    }
    console.log(
      `│  These overrides prevent the Wizard from accessing the PostHog LLM Gateway.`,
    );
    return Promise.resolve();
  }

  showAuthError(): void {
    console.log(`✖  Authentication failed (401)`);
    console.log(
      `│  Claude Code auth is conflicting with the wizard. Please try again after logging out:`,
    );
    console.log(`│    claude auth logout`);
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

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const completed = todos.filter(
      (t) => t.status === TaskStatus.Completed,
    ).length;
    const inProgress = todos.find((t) => t.status === TaskStatus.InProgress);
    if (inProgress) {
      console.log(
        `◌  [${completed}/${todos.length}] ${
          inProgress.activeForm || inProgress.content
        }`,
      );
    }
  }

  setEventPlan(_events: Array<{ name: string; description: string }>): void {
    // No-op in CI mode
  }
}
