/**
 * WizardStore — Nanostore-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 *
 * Navigation is delegated to WizardRouter.
 * The active screen is derived from session state — not imperatively set.
 * Overlays (outage, etc.) are the only imperative navigation.
 *
 * All session mutations that affect screen resolution go through
 * explicit setters so emitChange() is always called.
 */

import { atom, map } from 'nanostores';
import { TaskStatus } from '../wizard-ui.js';
import {
  type WizardSession,
  type OutroData,
  type CloudRegion,
  type DiscoveredFeature,
  AdditionalFeature,
  RunPhase,
  buildSession,
} from '../../lib/wizard-session.js';
import {
  WizardRouter,
  type ScreenName,
  Screen,
  Overlay,
  Flow,
} from './router.js';

export { TaskStatus, Screen, Overlay, Flow, RunPhase };
export type { ScreenName, OutroData, WizardSession, CloudRegion };

export interface TaskItem {
  label: string;
  activeForm?: string;
  status: TaskStatus;
  /** Legacy compat */
  done: boolean;
}

export class WizardStore {
  // ── Internal nanostore atoms ─────────────────────────────────────
  private $session = map<WizardSession>(buildSession({}));
  private $statusMessages = atom<string[]>([]);
  private $tasks = atom<TaskItem[]>([]);
  private $version = atom(0);

  version = '';

  /** Navigation router — resolves active screen from session state. */
  readonly router: WizardRouter;

  /**
   * Setup promise — IntroScreen resolves this when the user picks a region.
   * bin.ts awaits it before calling runWizard.
   */
  private _resolveSetup!: (region: CloudRegion) => void;
  readonly setupComplete: Promise<CloudRegion> = new Promise((resolve) => {
    this._resolveSetup = resolve;
  });

  constructor(flow: Flow = Flow.Wizard) {
    this.router = new WizardRouter(flow);
  }

  // ── State accessors (read from atoms) ────────────────────────────

  get session(): WizardSession {
    return this.$session.get();
  }

  set session(value: WizardSession) {
    this.$session.set(value);
  }

  get statusMessages(): string[] {
    return this.$statusMessages.get();
  }

  get tasks(): TaskItem[] {
    return this.$tasks.get();
  }

  // ── Session setters ─────────────────────────────────────────────
  // Every setter that affects screen resolution calls emitChange().
  // Business logic calls these instead of mutating session directly.

  setCloudRegion(region: CloudRegion): void {
    this.$session.setKey('cloudRegion', region);
    this.emitChange();
  }

  /** Also unblocks bin.ts via the setupComplete promise. */
  completeSetup(region: CloudRegion): void {
    this.$session.setKey('cloudRegion', region);
    this._resolveSetup(region);
    this.emitChange();
  }

  setRunPhase(phase: RunPhase): void {
    this.$session.setKey('runPhase', phase);
    this.emitChange();
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    this.$session.setKey('credentials', credentials);
    this.emitChange();
  }

  setFrameworkConfig(
    integration: WizardSession['integration'],
    config: WizardSession['frameworkConfig'],
  ): void {
    this.$session.setKey('integration', integration);
    this.$session.setKey('frameworkConfig', config);
    this.emitChange();
  }

  setDetectionComplete(): void {
    this.$session.setKey('detectionComplete', true);
    this.emitChange();
  }

  setDetectedFramework(label: string): void {
    this.$session.setKey('detectedFrameworkLabel', label);
    this.emitChange();
  }

  setLoginUrl(url: string | null): void {
    this.$session.setKey('loginUrl', url);
    this.emitChange();
  }

  setServiceStatus(
    status: { description: string; statusPageUrl: string } | null,
  ): void {
    this.$session.setKey('serviceStatus', status);
    this.emitChange();
  }

  addDiscoveredFeature(feature: DiscoveredFeature): void {
    if (!this.session.discoveredFeatures.includes(feature)) {
      this.session.discoveredFeatures.push(feature);
      this.emitChange();
    }
  }

  /**
   * Enable an additional feature: enqueue it for the stop hook
   * and set any feature-specific session flags.
   */
  enableFeature(feature: AdditionalFeature): void {
    if (!this.session.additionalFeatureQueue.includes(feature)) {
      this.session.additionalFeatureQueue.push(feature);
    }
    // Feature-specific flags
    if (feature === AdditionalFeature.LLM) {
      this.session.llmOptIn = true;
    }
    this.emitChange();
  }

  setMcpComplete(): void {
    this.$session.setKey('mcpComplete', true);
    this.emitChange();
  }

  setOutroData(data: OutroData): void {
    this.$session.setKey('outroData', data);
    this.emitChange();
  }

  setFrameworkContext(key: string, value: unknown): void {
    const ctx = { ...this.$session.get().frameworkContext, [key]: value };
    this.$session.setKey('frameworkContext', ctx);
    this.emitChange();
  }

  // ── Derived state ───────────────────────────────────────────────

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

  // ── Change notification ─────────────────────────────────────────

  getVersion(): number {
    return this.$version.get();
  }

  /**
   * Notify React that state has changed.
   * The router re-resolves the active screen on next render.
   */
  emitChange(): void {
    this.router._setDirection('push');
    this.$version.set(this.$version.get() + 1);
  }

  // ── Overlay navigation ──────────────────────────────────────────

  pushOverlay(overlay: Overlay): void {
    this.router._setDirection('push');
    this.router.pushOverlay(overlay);
    this.$version.set(this.$version.get() + 1);
  }

  popOverlay(): void {
    this.router._setDirection('pop');
    this.router.popOverlay();
    this.$version.set(this.$version.get() + 1);
  }

  // ── Agent observation state ─────────────────────────────────────

  pushStatus(message: string): void {
    this.$statusMessages.set([...this.$statusMessages.get(), message]);
    this.emitChange();
  }

  setTasks(tasks: TaskItem[]): void {
    this.$tasks.set(tasks);
    this.emitChange();
  }

  updateTask(index: number, done: boolean): void {
    const tasks = this.$tasks.get();
    if (tasks[index]) {
      const updated = [...tasks];
      updated[index] = {
        ...updated[index],
        done,
        status: done ? TaskStatus.Completed : TaskStatus.Pending,
      };
      this.$tasks.set(updated);
      this.emitChange();
    }
  }

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

    const retained = this.$tasks
      .get()
      .filter((t) => t.done && !incomingLabels.has(t.label));

    this.$tasks.set([...retained, ...incoming]);
    this.emitChange();
  }

  // ── React integration ───────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    return this.$version.listen(() => callback());
  }

  getSnapshot(): number {
    return this.$version.get();
  }
}
