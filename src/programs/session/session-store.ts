/**
 * SessionStore — the session and run state every host shares.
 *
 * The TUI and headless each build one, and an embedder may build its own;
 * `runProgram` reads the session from it and writes detection, the login,
 * readiness and the run's progress back. Every write goes through a setter, so
 * a subscriber sees each change and nobody holds a stale copy. The TUI layers
 * its display state, screens and gates on top and reacts to this store's
 * changes.
 */

import { atom, map, type MapStore } from 'nanostores';
import type {
  AgentProgress,
  AskAnswers,
  PendingQuestion,
  TaskNotice,
} from '@agent/types';
import type { Credentials } from '@shared/api';
import type { DiscoveredFeature } from '@shared/discovered-feature';
import {
  WizardReadiness,
  getBlockingServiceKeys,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { OutroKind, type OutroData } from '@shared/outro';
import { RunPhase, ScanConsent } from '@shared/run-state';
import { appendStatus } from '@shared/status-history';
import { TaskStatus, isTaskStatus } from '@shared/task-status';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { reportWarehouseSourcesDetected } from '../detection/integration';
import type { ProgramReadyContext } from '../program-step';
import type { WizardSession } from './wizard-session';

export interface TaskItem {
  id?: string;
  source?: string;
  sourceStatus?: string;
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

/** A login the store records: what a credentials provider resolved. */
export type SessionLogin = {
  posthog: Credentials;
  project: WizardSession['apiProject'];
  apiUser: WizardSession['apiUser'];
  roleAtOrganization?: string | null;
};

// Capture blocked skill downloads once per readiness result.
function captureHealthCheckBlocked(result: WizardReadinessResult): void {
  try {
    const health = result.health;
    const blockingKeys = getBlockingServiceKeys(health);
    const attempts = health.skillsOrigin.rawIndicator?.match(/attempts=(\d+)/);
    const retriesUsed = Math.max(0, attempts ? Number(attempts[1]) - 1 : 0);
    analytics.wizardCapture('health check blocked', {
      decision: 'skills-origin-down',
      blocking_keys: blockingKeys,
      retries_used: retriesUsed,
    });
  } catch (err) {
    logToFile(
      `[health-checks] failed to capture analytics: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export class SessionStore {
  private readonly $session: MapStore<WizardSession>;
  private readonly $statusMessages = atom<string[]>([]);
  private readonly $tasks = atom<TaskItem[]>([]);
  private readonly $eventPlan = atom<PlannedEvent[]>([]);
  private readonly $handoffText = atom<string | null>(null);
  private readonly $version = atom(0);
  private batchDepth = 0;
  private batchDirty = false;

  private resolvePendingQuestionFn: ((answers: AskAnswers) => void) | null =
    null;
  private resolveTaskNoticeFn: ((keep: boolean) => void) | null = null;

  constructor(session: WizardSession) {
    this.$session = map<WizardSession>(session);
  }

  // ── Reads ─────────────────────────────────────────────────────────

  get session(): WizardSession {
    return this.$session.get();
  }

  /** Replace the whole session, e.g. once the host has built it from its launch values. */
  set session(value: WizardSession) {
    this.$session.set(value);
    this.emit();
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

  get handoffText(): string | null {
    return this.$handoffText.get();
  }

  getFrameworkContext(key: string): unknown {
    return this.session.frameworkContext[key];
  }

  // ── Change notification ───────────────────────────────────────────

  /** Called after every change, with no initial call. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    return this.$version.listen(() => listener());
  }

  getVersion(): number {
    return this.$version.get();
  }

  private emit(): void {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    this.$version.set(this.$version.get() + 1);
  }

  /** Make several writes, then notify once. */
  batch(writes: () => void): void {
    this.batchDepth += 1;
    try {
      writes();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.batchDirty) {
        this.batchDirty = false;
        this.emit();
      }
    }
  }

  // ── Session writes ────────────────────────────────────────────────

  /** Write several session fields, then notify once. */
  update(patch: Partial<WizardSession>): void {
    for (const [key, value] of Object.entries(patch)) {
      this.$session.setKey(key as never, value as never);
    }
    this.emit();
  }

  private set<K extends keyof WizardSession>(
    key: K,
    value: WizardSession[K],
  ): void {
    this.$session.setKey(key, value as never);
    this.emit();
  }

  /**
   * Hand `work` a copy of the session, then write back what it changed. For
   * program code that writes to the session object it is given, such as
   * `ciPreRun` and a `run` function. Framework-context keys merge into the
   * live context, so writes made meanwhile through a setter are kept.
   */
  async edit<T>(work: (draft: WizardSession) => Promise<T> | T): Promise<T> {
    const before = this.session;
    const draft: WizardSession = {
      ...before,
      frameworkContext: { ...before.frameworkContext },
    };
    try {
      return await work(draft);
    } finally {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (key === 'frameworkContext') continue;
        if (value !== before[key as keyof WizardSession]) {
          patch[key] = value;
        }
      }
      const context = Object.entries(draft.frameworkContext).filter(
        ([key, value]) => before.frameworkContext[key] !== value,
      );
      if (context.length > 0) {
        patch.frameworkContext = {
          ...this.session.frameworkContext,
          ...Object.fromEntries(context),
        };
      }
      if (Object.keys(patch).length > 0)
        this.update(patch as Partial<WizardSession>);
    }
  }

  setRunPhase(phase: RunPhase): void {
    analytics.setTag('run_phase', phase);
    this.set('runPhase', phase);
  }

  /** Record a login: the credentials, the project, the user and their role. The login's host reports `auth complete`. */
  setLogin(login: SessionLogin): void {
    if (login.posthog.projectId) {
      analytics.setTag('project_id', login.posthog.projectId);
    }
    this.update({
      credentials: login.posthog,
      apiProject: login.project,
      apiUser: login.apiUser,
      roleAtOrganization:
        login.roleAtOrganization ?? login.apiUser?.role_at_organization ?? null,
    });
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    if (credentials?.projectId) {
      analytics.setTag('project_id', credentials.projectId);
    }
    analytics.wizardCapture('auth complete', {
      project_id: credentials?.projectId,
    });
    this.set('credentials', credentials);
  }

  /** Post-refresh credential swap: no `auth complete`, the user logged in once. */
  setAccessToken(credentials: WizardSession['credentials']): void {
    this.set('credentials', credentials);
  }

  setRoleAtOrganization(role: string | null): void {
    this.set('roleAtOrganization', role);
  }

  setApiUser(user: WizardSession['apiUser']): void {
    this.set('apiUser', user);
  }

  setFrameworkConfig(
    integration: WizardSession['integration'],
    config: WizardSession['frameworkConfig'],
  ): void {
    if (integration) analytics.setTag('integration', integration);
    this.update({
      integration,
      frameworkConfig: config,
      unsupportedVersion: null,
    });
  }

  setFrameworkContext(key: string, value: unknown): void {
    this.set('frameworkContext', {
      ...this.session.frameworkContext,
      [key]: value,
    });
  }

  setDetectionComplete(): void {
    this.set('detectionComplete', true);
  }

  setDetectedFramework(label: string): void {
    analytics.setTag('detected_framework', label);
    this.set('detectedFrameworkLabel', label);
  }

  setPosthogSdkDetected(detected: boolean): void {
    this.set('posthogSdkDetected', detected);
  }

  setSkillId(skillId: string | null): void {
    this.set('skillId', skillId);
  }

  setUnsupportedVersion(
    info: NonNullable<WizardSession['unsupportedVersion']>,
  ): void {
    this.set('unsupportedVersion', info);
  }

  addDiscoveredFeature(feature: DiscoveredFeature): void {
    if (this.session.discoveredFeatures.includes(feature)) return;
    this.set('discoveredFeatures', [
      ...this.session.discoveredFeatures,
      feature,
    ]);
  }

  /** Sharing is on; reversible until the host makes consent final. */
  grantSharing(): void {
    this.set('scanConsent', ScanConsent.Granted);
  }

  /** Sharing is off; suppresses reporting only, detection results stay. */
  declineSharing(): void {
    this.set('scanConsent', ScanConsent.Declined);
  }

  /** Report the warehouse scan once, when consent allows it. */
  reportWarehouseSources(): void {
    if (reportWarehouseSourcesDetected(this.session)) {
      this.set('warehouseSourcesReported', true);
    }
  }

  setAiSdkStampReported(): void {
    if (this.session.aiSdkStampReported) return;
    this.set('aiSdkStampReported', true);
  }

  setReadinessResult(result: WizardReadinessResult | null): void {
    if (result && result.decision === WizardReadiness.No) {
      captureHealthCheckBlocked(result);
    }
    this.set('readinessResult', result);
  }

  setOutroData(data: OutroData): void {
    this.set('outroData', data);
  }

  setDashboardUrl(url: string): void {
    logToFile(`store.setDashboardUrl: ${url}`);
    this.set('dashboardUrl', url);
  }

  setNotebookUrl(url: string): void {
    logToFile(`store.setNotebookUrl: ${url}`);
    this.set('notebookUrl', url);
  }

  // ── Run progress ──────────────────────────────────────────────────

  pushStatus(message: string): void {
    const msgs = this.$statusMessages.get();
    const next = appendStatus(msgs, message);
    if (next === msgs) return;
    this.$statusMessages.set(next);
    this.emit();
  }

  setTasks(tasks: TaskItem[]): void {
    this.$tasks.set(tasks);
    this.emit();
  }

  updateTask(index: number, done: boolean): void {
    const tasks = this.$tasks.get();
    if (!tasks[index]) return;
    const updated = [...tasks];
    updated[index] = {
      ...updated[index],
      done,
      status: done ? TaskStatus.Completed : TaskStatus.Pending,
    };
    this.$tasks.set(updated);
    this.emit();
  }

  /** Replace the live tasks with the agent's list, keeping finished ones from other sources. */
  syncTodos(
    todos: Array<{
      id?: string;
      source?: string;
      content: string;
      status: string;
      activeForm?: string;
    }>,
  ): void {
    const incoming = todos.map((t) => {
      const status = isTaskStatus(t.status) ? t.status : TaskStatus.Pending;
      return {
        id: t.id,
        source: t.source,
        sourceStatus: isTaskStatus(t.status) ? undefined : t.status,
        label: t.content,
        activeForm: t.activeForm,
        status,
        done: status === TaskStatus.Completed,
      };
    });
    const incomingLabels = new Set(incoming.map((t) => t.label));
    const sources = new Set(todos.map((t) => t.source));
    const retained = this.$tasks
      .get()
      .filter(
        (t) =>
          (t.status === TaskStatus.Completed ||
            t.status === TaskStatus.Failed ||
            t.status === TaskStatus.Skipped) &&
          (t.source ? !sources.has(t.source) : !incomingLabels.has(t.label)),
      );
    this.$tasks.set([...retained, ...incoming]);
    this.emit();
  }

  setEventPlan(events: PlannedEvent[]): void {
    this.$eventPlan.set(events);
    this.emit();
  }

  /** No-op on identical text: a change here means a network push downstream. */
  setHandoffText(text: string): void {
    if (this.$handoffText.get() === text) return;
    logToFile(`store.setHandoffText: ${text.length} chars`);
    this.$handoffText.set(text);
    this.emit();
  }

  // ── Questions and notices the agent waits on ──────────────────────

  /**
   * Hold the agent's wizard_ask request until an answerer resolves it: the
   * TUI's WizardAsk screen, or a headless control client. One at a time.
   */
  requestQuestion(question: PendingQuestion): Promise<AskAnswers> {
    if (this.resolvePendingQuestionFn) {
      throw new Error(
        'requestQuestion called while another wizard_ask request is pending',
      );
    }
    analytics.wizardCapture('wizard_ask shown', {
      source: question.source,
      question_count: question.questions.length,
      kinds: question.questions.map((q) => q.kind),
    });
    const answered = new Promise<AskAnswers>((resolve) => {
      this.resolvePendingQuestionFn = resolve;
    });
    this.set('pendingQuestion', question);
    return answered;
  }

  resolvePendingQuestion(answers: AskAnswers): void {
    const resolve = this.resolvePendingQuestionFn;
    this.resolvePendingQuestionFn = null;
    this.set('pendingQuestion', null);
    resolve?.(answers);
  }

  /** Cancel the open request with `__cancelled__` answers, so the skill decides. */
  cancelPendingQuestion(): void {
    const pending = this.session.pendingQuestion;
    if (!pending) return;
    const cancelled: AskAnswers = {};
    for (const q of pending.questions) cancelled[q.id] = '__cancelled__';
    this.resolvePendingQuestion(cancelled);
  }

  /** Hold an optional step's notice until it is answered: keep (`true`) or skip. */
  showTaskNotice(notice: TaskNotice): Promise<boolean> {
    const answered = new Promise<boolean>((resolve) => {
      this.resolveTaskNoticeFn = resolve;
    });
    this.set('taskNotice', notice);
    return answered;
  }

  resolveTaskNotice(keep: boolean): void {
    const resolve = this.resolveTaskNoticeFn;
    this.resolveTaskNoticeFn = null;
    this.set('taskNotice', null);
    resolve?.(keep);
  }

  // ── Views for program hooks ───────────────────────────────────────

  /** The writes a program's `onReady` detection makes, through this store. */
  readyContext(): ProgramReadyContext {
    const read = (): WizardSession => this.session;
    return {
      get session() {
        return read();
      },
      setFrameworkContext: (k, v) => this.setFrameworkContext(k, v),
      setFrameworkConfig: (i, c) =>
        this.setFrameworkConfig(
          i as WizardSession['integration'],
          c as WizardSession['frameworkConfig'],
        ),
      setDetectedFramework: (l) => this.setDetectedFramework(l),
      setPosthogSdkDetected: (d) => this.setPosthogSdkDetected(d),
      setSkillId: (id) => this.setSkillId(id),
      setUnsupportedVersion: (info) =>
        this.setUnsupportedVersion(
          info as NonNullable<WizardSession['unsupportedVersion']>,
        ),
      addDiscoveredFeature: (f) => this.addDiscoveredFeature(f),
      setDetectionComplete: () => this.setDetectionComplete(),
    };
  }
}

/** Record an agent progress event that is run state; display-only events change nothing here. */
export function applyAgentProgress(
  store: SessionStore,
  event: AgentProgress,
): void {
  switch (event.kind) {
    case 'lifecycle':
      if (event.phase === 'started') {
        store.setRunPhase(RunPhase.Running);
        return;
      }
      store.batch(() => {
        if (!store.session.outroData) {
          store.setOutroData({
            kind: OutroKind.Success,
            message: event.message,
          });
        }
        if (store.session.runPhase === RunPhase.Running) {
          store.setRunPhase(RunPhase.Completed);
        }
      });
      return;
    case 'status':
      store.pushStatus(event.message);
      return;
    case 'tasks':
      store.syncTodos(
        event.tasks.map((t) => ({
          id: t.id,
          source: t.source,
          content: t.content,
          status: t.status,
          activeForm: t.activeForm,
        })),
      );
      return;
    case 'url':
      if (event.which === 'dashboard') store.setDashboardUrl(event.url);
      else store.setNotebookUrl(event.url);
      return;
    case 'handoff':
      store.setHandoffText(event.text);
      return;
    case 'completion': {
      // A link the agent printed during the run wins over the outro's own.
      const { dashboardUrl, notebookUrl } = store.session;
      store.setOutroData({
        ...event.outro,
        dashboardUrl: dashboardUrl ?? event.outro.dashboardUrl ?? undefined,
        notebookUrl: notebookUrl ?? event.outro.notebookUrl ?? undefined,
      });
      return;
    }
    case 'binding':
      store.update({ binding: event.binding });
      return;
    case 'spinner':
    case 'log':
    case 'stage':
    case 'usage':
    case 'finalCost':
    case 'authError':
    case 'activity':
      return;
    default: {
      const unhandled: never = event;
      logToFile(
        `[session-store] unhandled progress ${JSON.stringify(unhandled)}`,
      );
    }
  }
}
