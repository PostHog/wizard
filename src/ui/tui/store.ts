/**
 * WizardStore — EventEmitter-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 *
 * Navigation is delegated to WizardRouter (flow pipelines + overlay stack).
 * The store exposes advance(), pushOverlay(), popOverlay() and tracks
 * observable agent state (tasks, status messages).
 */

import { EventEmitter } from 'events';
import { TaskStatus } from '../wizard-ui.js';
import {
  type WizardSession,
  type OutroData,
  buildSession,
} from '../../lib/wizard-session.js';
import {
  WizardRouter,
  type ScreenName,
  type OverlayScreen,
  type FlowScreen,
  type FlowName,
} from './router.js';

export { TaskStatus };
export type {
  ScreenName,
  OverlayScreen,
  FlowScreen,
  FlowName,
  OutroData,
  WizardSession,
};
export type CloudRegion = 'us' | 'eu';

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
  tasks: TaskItem[] = [];

  /** Navigation router — owns flow cursor + overlay stack. */
  readonly router: WizardRouter;

  /** The single source of truth for every decision the wizard needs. */
  session: WizardSession = buildSession({});

  /**
   * Setup promise — IntroScreen resolves this when the user picks a region.
   * bin.ts awaits it before calling runWizard.
   */
  private _resolveSetup!: (region: CloudRegion) => void;
  readonly setupComplete: Promise<CloudRegion> = new Promise((resolve) => {
    this._resolveSetup = resolve;
  });

  constructor(flow: FlowName = 'wizard') {
    super();
    this.router = new WizardRouter(flow);
  }

  completeSetup(region: CloudRegion): void {
    this.session.cloudRegion = region;
    this._resolveSetup(region);
  }

  /** The screen that should be rendered right now. */
  get currentScreen(): ScreenName {
    return this.router.activeScreen;
  }

  /** Direction hint for screen transitions. */
  get lastNavDirection(): 'push' | 'pop' | null {
    return this.router.lastNavDirection;
  }

  private _version = 0;

  getVersion(): number {
    return this._version;
  }

  private bump(): void {
    this._version++;
    this.emit('change');
  }

  // ── Flow navigation ───────────────────────────────────────────────

  /**
   * Advance to the next flow screen, skipping any where show() is false.
   * Screens call this when they're done.
   */
  advance(): void {
    this.router._setDirection('push');
    const next = this.router.advance(this.session);
    if (next) {
      this.bump();
    }
  }

  /**
   * Jump the flow cursor to a specific screen.
   * Use for error recovery (e.g., error boundary → outro).
   */
  jumpTo(screen: FlowScreen): void {
    this.router._setDirection('push');
    this.router.jumpTo(screen);
    this.bump();
  }

  /**
   * Transition to the run screen. Called by InkUI.startRun().
   */
  startFlow(screen: FlowScreen): void {
    this.router._setDirection('push');
    this.router.jumpTo(screen);
    this.bump();
  }

  // ── Overlay navigation ────────────────────────────────────────────

  /**
   * Push an overlay that interrupts the current flow.
   * The flow resumes when the overlay is dismissed.
   */
  pushOverlay(screen: OverlayScreen): void {
    this.router._setDirection('push');
    this.router.pushOverlay(screen);
    this.bump();
  }

  /**
   * Dismiss the topmost overlay. The flow screen underneath resumes.
   */
  popOverlay(): void {
    this.router._setDirection('pop');
    this.router.popOverlay();
    this.bump();
  }

  // ── Agent state ───────────────────────────────────────────────────

  pushStatus(message: string): void {
    this.statusMessages.push(message);
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

    const retained = this.tasks.filter(
      (t) => t.done && !incomingLabels.has(t.label),
    );

    this.tasks = [...retained, ...incoming];
    this.bump();
  }

  // ── Outro ─────────────────────────────────────────────────────────

  setOutroData(data: OutroData): void {
    this.session.outroData = data;
    this.bump();
  }

  // ── React integration ─────────────────────────────────────────────

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
