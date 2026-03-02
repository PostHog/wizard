/* eslint-disable no-console */
/**
 * LoggingUI — Logging-only implementation for CI mode.
 * No prompts, no TUI, no interactivity. Just console output.
 */

import { TaskStatus, type WizardUI, type SpinnerHandle } from './wizard-ui';

export class LoggingUI implements WizardUI {
  setSetupData(data: {
    wizardLabel?: string;
    detectedFramework?: string;
    betaNotice?: string;
    preRunNotice?: string;
    disclosure?: string;
  }): void {
    if (data.wizardLabel) console.log(`┌  ${data.wizardLabel}`);
    if (data.detectedFramework)
      console.log(`✔  Detected integration: ${data.detectedFramework}`);
    if (data.betaNotice) console.log(`│  ${data.betaNotice}`);
    if (data.preRunNotice) console.log(`▲  ${data.preRunNotice}`);
    if (data.disclosure) console.log(`│  ${data.disclosure}`);
  }

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

  setLoginUrl(url: string | null): void {
    if (url) {
      console.log(
        `│  If the browser didn't open automatically, use this link:`,
      );
      console.log(`│  ${url}`);
    }
  }

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    console.log(`▲  Claude/Anthropic services are experiencing issues.`);
    console.log(`│  Status: ${data.description}`);
    console.log(`│  Status page: ${data.statusPageUrl}`);
    console.log(
      `│  The wizard may not work reliably while services are affected.`,
    );
  }

  startRun(): void {
    // No-op in CI mode
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
}
