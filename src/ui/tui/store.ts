/**
 * WizardStore — Nanostore-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 *
 * The active screen is derived from session state — WizardRouter walks
 * the flow and shows the first step whose `isComplete` is still false.
 *
 * Define a step `gate` if your screen needs to await user interactions.
 * bin.ts calls `await store.getGate(stepId)` to pause until the gate
 * predicate becomes true.
 *
 * All session mutations that affect screen resolution go through
 * explicit setters so emitChange() is always called.
 */

import { atom, map } from 'nanostores';
import { TaskStatus } from '../wizard-ui.js';
import {
  type WizardSession,
  type OutroData,
  type DiscoveredFeature,
  AdditionalFeature,
  McpOutcome,
  RunPhase,
  buildSession,
} from '../../lib/wizard-session.js';
import type { SettingsConflict } from '../../lib/agent/agent-interface.js';
import type { WizardReadinessResult } from '../../lib/health-checks/readiness.js';
import {
  WizardRouter,
  type ScreenName,
  Screen,
  Overlay,
  Flow,
} from './router.js';
import { analytics, sessionProperties } from '../../utils/analytics.js';
import type {
  StoreInitContext,
  WorkflowReadyContext,
} from '../../lib/workflows/workflow-step.js';
import { WORKFLOW_STEPS } from './flows.js';

export { TaskStatus, Screen, Overlay, Flow, RunPhase, McpOutcome };
export type { ScreenName, OutroData, WizardSession };

export interface TaskItem {
  label: string;
  activeForm?: string;
  status: TaskStatus;
  /** Legacy compat */
  done: boolean;
}

export interface PlannedEvent {
  name: string;
  description: string;
}

interface GateEntry {
  predicate: (session: WizardSession) => boolean;
  promise: Promise<void>;
  resolve: () => void;
  resolved: boolean;
}

export class WizardStore {
  // ── Internal nanostore atoms ─────────────────────────────────────
  private $session = map<WizardSession>(buildSession({}));
  private $statusMessages = atom<string[]>([]);
  private $statusExpanded = atom(false);
  private $tasks = atom<TaskItem[]>([]);
  private $eventPlan = atom<PlannedEvent[]>([]);
  private $learnCardBlockIdx = atom(0);
  private $learnCardComplete = atom(false);
  private $version = atom(0);

  /** Last screen seen — used to detect screen transitions for analytics. */
  private _lastScreen: ScreenName | null = null;

  /** Hooks run when transitioning onto a screen. */
  private _enterScreenHooks = new Map<ScreenName, (() => void)[]>();

  /** Gate promises derived from workflow step definitions. */
  private _gates = new Map<string, GateEntry>();

  version = '';

  /** Navigation router — resolves active screen from session state. */
  readonly router: WizardRouter;

  /** Blocks agent execution until the settings-override overlay is dismissed. */
  private _resolveSettingsOverride: (() => void) | null = null;
  private _backupAndFixSettings: (() => boolean) | null = null;

  /** Blocks OAuth flow until the port-conflict overlay is dismissed. */
  private _resolvePortConflict: (() => void) | null = null;

  constructor(flow: Flow = Flow.PostHogIntegration) {
    this.router = new WizardRouter(flow);
    this._initFromWorkflow(flow);
  }

  /**
   * Scan workflow steps for gate predicates and onInit callbacks.
   * Creates gate promises and fires init work.
   */
  private _initFromWorkflow(flow: Flow): void {
    const steps = WORKFLOW_STEPS[flow];
    if (!steps) return;

    // Create gate promises from steps that define them
    for (const step of steps) {
      if (step.gate) {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => {
          resolve = r;
        });
        this._gates.set(step.id, {
          predicate: step.gate,
          promise,
          resolve,
          resolved: false,
        });
      }
    }

    // Run onInit callbacks with a minimal context interface.
    // Arrow functions capture `this` from _initFromWorkflow so we don't
    // need to alias it.
    const getSession = (): WizardSession => this.session;
    const ctx: StoreInitContext = {
      get session() {
        return getSession();
      },
      setReadinessResult: (r) => this.setReadinessResult(r),
      setFrameworkContext: (k, v) => this.setFrameworkContext(k, v),
      emitChange: () => this.emitChange(),
    };
    for (const step of steps) {
      step.onInit?.(ctx);
    }
  }

  /**
   * Run all `onReady` hooks declared by the current flow's steps, in
   * order. Must be called after `store.session = session` so hooks see
   * the real installDir. bin.ts calls this generically — it doesn't
   * need to know which workflow has which pre-flow work.
   */
  async runReadyHooks(): Promise<void> {
    const steps = WORKFLOW_STEPS[this.router.activeFlow];
    if (!steps) return;
    const ctx: WorkflowReadyContext = {
      session: this.session,
      setFrameworkContext: (k, v) => this.setFrameworkContext(k, v),
      setFrameworkConfig: (i, c) => this.setFrameworkConfig(i, c),
      setDetectedFramework: (l) => this.setDetectedFramework(l),
      setUnsupportedVersion: (info) => this.setUnsupportedVersion(info),
      addDiscoveredFeature: (f) => this.addDiscoveredFeature(f),
      setDetectionComplete: () => this.setDetectionComplete(),
    };
    for (const step of steps) {
      if (step.onReady) {
        await step.onReady(ctx);
      }
    }
  }

  // ── Gate API ────────────────────────────────────────────────────

  /**
   * Get a gate promise by step ID — the primary blocking checkpoint API
   * for bin.ts. `await store.getGate('...')` parks the caller until the
   * corresponding workflow step's gate predicate flips to true (if the
   * predicate stays false, the caller stays parked indefinitely — the
   * TUI keeps rendering so the user can resolve whatever is blocking).
   *
   * If the workflow doesn't define a step with this ID, or the step
   * has no `gate` predicate, this returns an already-resolved promise
   * so bin.ts flows straight through. This lets workflows opt in to
   * gates on a per-step basis without bin.ts needing to know which
   * gates exist in which flow.
   */
  getGate(stepId: string): Promise<void> {
    return this._gates.get(stepId)?.promise ?? Promise.resolve();
  }

  /**
   * Re-evaluate every gate predicate against the current session and
   * resolve any whose predicate now returns true. Called after every
   * emitChange(), so gates unblock as soon as the session mutation
   * that satisfies them lands. Gates only resolve once — a predicate
   * that goes true → false → true will NOT re-block a caller that
   * already awaited through.
   */
  private _checkGates(): void {
    for (const [, gate] of this._gates) {
      if (!gate.resolved && gate.predicate(this.session)) {
        gate.resolved = true;
        gate.resolve();
      }
    }
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

  get eventPlan(): PlannedEvent[] {
    return this.$eventPlan.get();
  }

  get statusExpanded(): boolean {
    return this.$statusExpanded.get();
  }

  toggleStatusExpanded(): void {
    this.$statusExpanded.set(!this.$statusExpanded.get());
    this.emitChange();
  }

  setStatusExpanded(expanded: boolean): void {
    if (this.$statusExpanded.get() !== expanded) {
      this.$statusExpanded.set(expanded);
      this.emitChange();
    }
  }

  // ── Session setters ─────────────────────────────────────────────
  // Every setter that affects screen resolution calls emitChange().
  // Business logic calls these instead of mutating session directly.

  /** Sets setupConfirmed. Gate resolves via _checkGates(). */
  completeSetup(): void {
    this.$session.setKey('setupConfirmed', true);
    analytics.wizardCapture('setup confirmed', sessionProperties(this.session));
    this.emitChange();
  }

  setRunPhase(phase: RunPhase): void {
    this.$session.setKey('runPhase', phase);
    this.emitChange();
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    this.$session.setKey('credentials', credentials);
    analytics.wizardCapture('auth complete', {
      project_id: credentials?.projectId,
    });
    this.emitChange();
  }

  setFrameworkConfig(
    integration: WizardSession['integration'],
    config: WizardSession['frameworkConfig'],
  ): void {
    this.$session.setKey('integration', integration);
    this.$session.setKey('frameworkConfig', config);
    this.$session.setKey('unsupportedVersion', null);
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

  setUnsupportedVersion(info: {
    current: string;
    minimum: string;
    docsUrl: string;
  }): void {
    this.$session.setKey('unsupportedVersion', info);
    this.emitChange();
  }

  setLoginUrl(url: string | null): void {
    this.$session.setKey('loginUrl', url);
    this.emitChange();
  }

  setReadinessResult(result: WizardReadinessResult | null): void {
    this.$session.setKey('readinessResult', result);
    this.emitChange();
  }

  /** User dismissed the blocking outage screen. Gate resolves via _checkGates(). */
  dismissOutage(): void {
    this.$session.setKey('outageDismissed', true);
    this.emitChange();
  }

  /**
   * Push the settings-override overlay and return a promise that blocks
   * until the user dismisses it via backupAndFixSettingsOverride().
   */
  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    const allKeys = conflicts.flatMap((c) => c.keys);
    this.$session.setKey('settingsOverrideKeys', allKeys);
    this.$session.setKey('settingsConflicts', conflicts);
    this._backupAndFixSettings = backupAndFix;

    const hasReadOnly = conflicts.some((c) => !c.writable);
    if (hasReadOnly) {
      this.pushOverlay(Overlay.ManagedSettings);
    } else {
      this.pushOverlay(Overlay.SettingsOverride);
    }

    return new Promise((resolve) => {
      this._resolveSettingsOverride = resolve;
    });
  }

  /**
   * Push the port-conflict overlay and return a promise that blocks
   * until the user kills the blocking process or exits.
   */
  showPortConflict(processInfo: {
    command: string;
    pid: string;
    user: string;
  }): Promise<void> {
    this.$session.setKey('portConflictProcess', processInfo);
    this.pushOverlay(Overlay.PortConflict);
    return new Promise((resolve) => {
      this._resolvePortConflict = resolve;
    });
  }

  /** Dismiss the port-conflict overlay after the user kills the process. */
  resolvePortConflict(): void {
    this.$session.setKey('portConflictProcess', null);
    this.popOverlay();
    this._resolvePortConflict?.();
    this._resolvePortConflict = null;
  }

  /**
   * Back up .claude/settings.json. Dismisses the overlay on success.
   */
  backupAndFixSettingsOverride(): boolean {
    const ok = this._backupAndFixSettings?.() ?? false;
    if (ok) {
      this.$session.setKey('settingsOverrideKeys', null);
      this.$session.setKey('settingsConflicts', null);
      this.popOverlay();
      this._resolveSettingsOverride?.();
      this._resolveSettingsOverride = null;
      this._backupAndFixSettings = null;
    }
    return ok;
  }

  /** Push the auth-error overlay (no dismiss — user must exit). */
  showAuthError(): void {
    this.pushOverlay(Overlay.AuthError);
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
    analytics.wizardCapture('feature enabled', { feature });
    this.emitChange();
  }

  setMcpComplete(
    outcome: McpOutcome = McpOutcome.Skipped,
    installedClients: string[] = [],
  ): void {
    this.$session.setKey('mcpComplete', true);
    this.$session.setKey('mcpOutcome', outcome);
    this.$session.setKey('mcpInstalledClients', installedClients);
    analytics.wizardCapture('mcp complete', {
      mcp_outcome: outcome,
      mcp_installed_clients: installedClients,
      ...sessionProperties(this.session),
    });
    this.emitChange();
  }

  setSkillsComplete(kept: boolean): void {
    this.$session.setKey('skillsComplete', true);
    analytics.wizardCapture('skills complete', {
      skills_kept: kept,
      ...sessionProperties(this.session),
    });
    this.emitChange();
  }

  setOutroDismissed(): void {
    this.$session.setKey('outroDismissed', true);
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
   * Gate predicates are checked and resolved if ready.
   */
  emitChange(): void {
    this.router._setDirection('push');
    this.$version.set(this.$version.get() + 1);
    this._checkGates();
    this._detectTransition();
  }

  // ── Overlay navigation ──────────────────────────────────────────

  pushOverlay(overlay: Overlay): void {
    this.router._setDirection('push');
    this.router.pushOverlay(overlay);
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  popOverlay(): void {
    this.router._setDirection('pop');
    this.router.popOverlay();
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  // ── Screen transition analytics ─────────────────────────────────

  /**
   * Register a callback to run when transitioning onto the given screen.
   * Fires after every transition that lands on this screen.
   */
  onEnterScreen(screen: ScreenName, fn: () => void): void {
    const list = this._enterScreenHooks.get(screen) ?? [];
    list.push(fn);
    this._enterScreenHooks.set(screen, list);
  }

  /**
   * Detect screen transitions, run enter-screen hooks, and fire analytics.
   * Called at the end of emitChange/pushOverlay/popOverlay.
   */
  private _detectTransition(): void {
    const next = this.router.resolve(this.session);
    const prev = this._lastScreen;
    if (prev !== null && next !== prev) {
      const hooks = this._enterScreenHooks.get(next);
      if (hooks) {
        for (const fn of hooks) fn();
      }
      analytics.wizardCapture(`screen ${next}`, {
        from_screen: prev,
        ...sessionProperties(this.session),
      });
    }
    this._lastScreen = next;
  }

  // ── Agent observation state ─────────────────────────────────────

  pushStatus(message: string): void {
    const msgs = this.$statusMessages.get();
    // Skip consecutive duplicate messages
    if (msgs.length > 0 && msgs[msgs.length - 1] === message) return;
    this.$statusMessages.set([...msgs, message]);
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

  setEventPlan(events: PlannedEvent[]): void {
    this.$eventPlan.set(events);
    this.emitChange();
  }

  get learnCardBlockIdx(): number {
    return this.$learnCardBlockIdx.get();
  }

  setLearnCardBlockIdx(idx: number): void {
    this.$learnCardBlockIdx.set(idx);
  }

  get learnCardComplete(): boolean {
    return this.$learnCardComplete.get();
  }

  setLearnCardComplete(): void {
    this.$learnCardComplete.set(true);
    this.emitChange();
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
