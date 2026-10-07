/* eslint-disable no-console */
/**
 * LoggingUI — Logging-only implementation for CI mode.
 * No prompts, no TUI, no interactivity. Just console output.
 */

import { consoleLog } from '@shared/console-log';
import { TaskStatus } from '@shared/task-status';
import type { AuthErrorDetail, SpinnerHandle } from '@agent/types';

export class LoggingUI {
  intro = (message: string): void => consoleLog.intro(message);
  outro = (message: string): void => consoleLog.outro(message);
  log = consoleLog.log;

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

  private lastTodoLine = '';

  syncTodos(
    todos: Array<{
      id?: string;
      source?: string;
      content: string;
      status: string;
      activeForm?: string;
    }>,
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
}
