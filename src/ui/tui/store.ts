/**
 * WizardStore — EventEmitter-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 *
 * Navigation stack + observable agent state (tasks, status messages).
 * Screens own their own business logic and UI — no store-driven prompts.
 */

import { EventEmitter } from 'events';
import { TaskStatus } from '../wizard-ui.js';

export { TaskStatus };

export type ScreenName = 'outage' | 'intro' | 'run' | 'mcp' | 'outro';

export type CloudRegion = 'us' | 'eu';

export interface OutroData {
  kind: 'success' | 'error' | 'cancel';
  message?: string;
  changes?: string[];
  nextSteps?: string[];
  docsUrl?: string;
  continueUrl?: string;
}

export interface TaskItem {
  label: string;
  activeForm?: string;
  status: TaskStatus;
  /** Legacy compat */
  done: boolean;
}

export class WizardStore extends EventEmitter {
  version = '';
  statusMessages: string[] = [];

  /** Service status data — shown on the outage screen when there's an outage */
  serviceStatus: { description: string; statusPageUrl: string } | null = null;

  tasks: TaskItem[] = [];

  /** Cloud region selected by IntroScreen — used by McpScreen for installation */
  cloudRegion: CloudRegion | null = null;

  screenStack: ScreenName[] = ['intro'];
  lastNavDirection: 'push' | 'pop' | null = null;
  outroData: OutroData | null = null;

  /**
   * Setup promise — IntroScreen resolves this when the user picks a region.
   * bin.ts awaits it before calling runWizard.
   */
  private _resolveSetup!: (region: CloudRegion) => void;
  readonly setupComplete: Promise<CloudRegion> = new Promise((resolve) => {
    this._resolveSetup = resolve;
  });

  completeSetup(region: CloudRegion): void {
    this.cloudRegion = region;
    this._resolveSetup(region);
  }

  get currentScreen(): ScreenName {
    return this.screenStack[this.screenStack.length - 1];
  }

  private _version = 0;

  getVersion(): number {
    return this._version;
  }

  private bump(): void {
    this._version++;
    this.emit('change');
  }

  pushStatus(message: string): void {
    this.statusMessages.push(message);
    this.bump();
  }

  setServiceStatus(data: { description: string; statusPageUrl: string }): void {
    this.serviceStatus = data;
    this.bump();
  }

  setTasks(tasks: TaskItem[]): void {
    this.tasks = tasks;
    this.bump();
  }

  updateTask(index: number, done: boolean): void {
    if (this.tasks[index]) {
      this.tasks[index].done = done;
      this.tasks[index].status = done
        ? TaskStatus.Completed
        : TaskStatus.Pending;
      this.bump();
    }
  }

  /**
   * Sync tasks from SDK TodoWrite tool_use blocks.
   * Retains previously completed tasks that aren't in the new list
   * (the agent resets its todo list on context compaction).
   */
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const incoming = todos.map((t) => ({
      label: t.content,
      activeForm: t.activeForm,
      status: (t.status as TaskStatus) || TaskStatus.Pending,
      done: t.status === TaskStatus.Completed,
    }));

    const incomingLabels = new Set(incoming.map((t) => t.label));

    // Keep completed tasks from before that aren't in the new list
    const retained = this.tasks.filter(
      (t) => t.done && !incomingLabels.has(t.label),
    );

    this.tasks = [...retained, ...incoming];
    this.bump();
  }

  setScreen(screen: ScreenName): void {
    this.lastNavDirection = 'push';
    this.screenStack = [screen];
    this.bump();
  }

  pushScreen(screen: ScreenName): void {
    this.lastNavDirection = 'push';
    this.screenStack.push(screen);
    this.bump();
  }

  popScreen(): void {
    if (this.screenStack.length > 1) {
      this.lastNavDirection = 'pop';
      this.screenStack.pop();
      this.bump();
    }
  }

  setOutroData(data: OutroData): void {
    this.outroData = data;
    this.bump();
  }

  subscribe(callback: () => void): () => void {
    this.on('change', callback);
    return () => {
      this.off('change', callback);
    };
  }

  getSnapshot(): number {
    return this._version;
  }
}
