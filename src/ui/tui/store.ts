/**
 * WizardStore — EventEmitter-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 *
 * Navigation is delegated to WizardRouter.
 * The active screen is derived from session state — not imperatively set.
 * Overlays (outage, etc.) are the only imperative navigation.
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
  Screen,
  Overlay,
  Flow,
} from './router.js';

export { TaskStatus, Screen, Overlay, Flow };
export type { ScreenName, OutroData, WizardSession };
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

  /** Navigation router — resolves active screen from session state. */
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

  constructor(flow: Flow = Flow.Wizard) {
    super();
    this.router = new WizardRouter(flow);
  }

  completeSetup(region: CloudRegion): void {
    this.session.cloudRegion = region;
    this._resolveSetup(region);
  }

  /**
   * The screen that should be rendered right now.
   * Derived from session state via the router.
   */
  get currentScreen(): ScreenName {
    return this.router.resolve(this.session);
  }

  /** Direction hint for screen transitions. */
  get lastNavDirection(): 'push' | 'pop' | null {
    return this.router.lastNavDirection;
  }

  private _version = 0;

  getVersion(): number {
    return this._version;
  }

  /**
   * Notify React that state has changed.
   * The router re-resolves the active screen on next render.
   */
  emitChange(): void {
    this.router._setDirection('push');
    this._version++;
    this.emit('change');
  }

  // ── Overlay navigation ────────────────────────────────────────────

  /**
   * Push an overlay that interrupts the current flow.
   * The flow resumes when the overlay is dismissed.
   */
  pushOverlay(overlay: Overlay): void {
    this.router._setDirection('push');
    this.router.pushOverlay(overlay);
    this._version++;
    this.emit('change');
  }

  /**
   * Dismiss the topmost overlay. The flow screen underneath resumes.
   */
  popOverlay(): void {
    this.router._setDirection('pop');
    this.router.popOverlay();
    this._version++;
    this.emit('change');
  }

  // ── Agent state ───────────────────────────────────────────────────

  pushStatus(message: string): void {
    this.statusMessages.push(message);
    this.emitChange();
  }

  setTasks(tasks: TaskItem[]): void {
    this.tasks = tasks;
    this.emitChange();
  }

  updateTask(index: number, done: boolean): void {
    if (this.tasks[index]) {
      this.tasks[index].done = done;
      this.tasks[index].status = done
        ? TaskStatus.Completed
        : TaskStatus.Pending;
      this.emitChange();
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
    this.emitChange();
  }

  // ── Outro ─────────────────────────────────────────────────────────

  setOutroData(data: OutroData): void {
    this.session.outroData = data;
    this.emitChange();
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
