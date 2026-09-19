/**
 * RunStore — the state of one agent run: the run's session copy, its tasks,
 * status, phase, outro, and the questions the agent asks. The agent writes
 * here through WizardUI; a FlowStore chains runs on top of it.
 */
import { atom, map } from 'nanostores';
import { computeTokenCostUsd } from '../agent-protocol/token-pricing.js';
import {
  RunPhase,
  type AskAnswers,
  type OutroData,
  type PendingQuestion,
  type TaskNotice,
  type WizardSession,
} from '../session/wizard-session.js';
import type { SettingsConflict } from '../services/claude-settings.js';
import { analytics } from '../shared/analytics.js';
import { logToFile } from '../shared/debug.js';
import {
  TaskStatus,
  isTaskStatus,
  type TokenUsageDelta,
} from '../ui/wizard-ui.js';

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

/** Running token/cost estimate for the Ctrl+T HUD; `costIsFinal` flips once the run's total is known. */
export interface TokenUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  costIsFinal: boolean;
}

export const EMPTY_TOKEN_USAGE: TokenUsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  costIsFinal: false,
};

/** Total tokens across all counters; the HUD and the exit line use it to detect "no agent turns yet". */
export function totalTokenCount(usage: TokenUsageSnapshot): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens
  );
}

/** FIFO cap on retained status lines; the status bar's expanded window. */
export const MAX_STATUS_MESSAGES = 10;

/** Session fields that belong to one agent run; the flow reads them from its active run. */
export const RUN_SESSION_KEYS = [
  'runPhase',
  'outroData',
  'outroDismissed',
  'pendingQuestion',
  'taskNotice',
  'mintHandoff',
  'settingsConflicts',
  'settingsOverrideKeys',
] as const satisfies readonly (keyof WizardSession)[];

export type RunSessionKey = (typeof RUN_SESSION_KEYS)[number];

/** What a fresh run starts from, whatever the session it was seeded with held. */
export const RUN_SESSION_DEFAULTS: Pick<WizardSession, RunSessionKey> = {
  runPhase: RunPhase.Idle,
  outroData: null,
  outroDismissed: false,
  pendingQuestion: null,
  taskNotice: null,
  mintHandoff: null,
  settingsConflicts: null,
  settingsOverrideKeys: null,
};

export function pickRunSession(
  session: WizardSession,
): Pick<WizardSession, RunSessionKey> {
  return Object.fromEntries(
    RUN_SESSION_KEYS.map((key) => [key, session[key]]),
  ) as Pick<WizardSession, RunSessionKey>;
}

export class RunStore {
  private $session: ReturnType<typeof map<WizardSession>>;
  private $statusMessages = atom<string[]>([]);
  private $tasks = atom<TaskItem[]>([]);
  private $eventPlan = atom<PlannedEvent[]>([]);
  private $handoffText = atom<string | null>(null);
  private $currentStage = atom<{ stage: string; startedAt: number } | null>(
    null,
  );
  private $tokenUsage = atom<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);
  private $version = atom(0);

  private _onTasksChanged: (() => void) | null = null;
  private _resolvePendingQuestion: ((answers: AskAnswers) => void) | null =
    null;
  private _resolveTaskNotice: ((keep: boolean) => void) | null = null;
  private _resolveSettingsOverride: (() => void) | null = null;
  private _backupAndFixSettings: (() => boolean) | null = null;

  constructor(session: WizardSession) {
    this.$session = map<WizardSession>(session);
  }

  // ── Session ──────────────────────────────────────────────────────

  get session(): WizardSession {
    return this.$session.get();
  }

  set session(value: WizardSession) {
    this.$session.set(value);
    this.emitChange();
  }

  /** Overwrite some session keys; `emit: false` lets an owner batch the change with its own commit. */
  patchSession(partial: Partial<WizardSession>, emit = true): void {
    this.$session.set({ ...this.$session.get(), ...partial });
    if (emit) this.emitChange();
  }

  private setKey<K extends keyof WizardSession>(
    key: K,
    value: WizardSession[K],
    emit = true,
  ): void {
    this.$session.setKey(key, value);
    if (emit) this.emitChange();
  }

  // ── Run atoms ────────────────────────────────────────────────────

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

  get currentStage(): { stage: string; startedAt: number } | null {
    return this.$currentStage.get();
  }

  get tokenUsage(): TokenUsageSnapshot {
    return this.$tokenUsage.get();
  }

  /** No-op when the stage hasn't changed, so `startedAt` measures real stage time. */
  setCurrentStage(stage: string): void {
    const cur = this.$currentStage.get();
    if (cur?.stage === stage) return;
    this.$currentStage.set({ stage, startedAt: Date.now() });
    this.emitChange();
  }

  setRunPhase(phase: RunPhase): void {
    this.$session.setKey('runPhase', phase);
    analytics.setTag('run_phase', phase);
    this.emitChange();
  }

  setOutroData(data: OutroData | null, emit = true): void {
    this.setKey('outroData', data, emit);
  }

  setOutroDismissed(dismissed = true): void {
    this.setKey('outroDismissed', dismissed);
  }

  setMintHandoff(
    action: NonNullable<WizardSession['mintHandoff']>,
    emit = true,
  ): void {
    this.setKey('mintHandoff', action, emit);
  }

  setSkillId(skillId: string | null, emit = true): void {
    this.setKey('skillId', skillId, emit);
  }

  setFrameworkContext(key: string, value: unknown, emit = true): void {
    const ctx = { ...this.$session.get().frameworkContext, [key]: value };
    this.setKey('frameworkContext', ctx, emit);
  }

  pushStatus(message: string): void {
    const msgs = this.$statusMessages.get();
    // Skip consecutive duplicate messages (no allocation on the hot path)
    if (msgs.length > 0 && msgs[msgs.length - 1] === message) return;
    const next =
      msgs.length >= MAX_STATUS_MESSAGES
        ? [...msgs.slice(msgs.length - MAX_STATUS_MESSAGES + 1), message]
        : [...msgs, message];
    this.$statusMessages.set(next);
    this.emitChange();
  }

  /** Approximate by design: a live indicator, corrected by `setFinalTokenCostUsd`. */
  addTokenUsage(delta: TokenUsageDelta): void {
    const cur = this.$tokenUsage.get();
    if (cur.costIsFinal) return;
    const deltaCostUsd = computeTokenCostUsd(delta);
    this.$tokenUsage.set({
      inputTokens: cur.inputTokens + delta.inputTokens,
      outputTokens: cur.outputTokens + delta.outputTokens,
      cacheReadTokens: cur.cacheReadTokens + delta.cacheReadTokens,
      cacheCreationTokens: cur.cacheCreationTokens + delta.cacheCreationTokens,
      costUsd: cur.costUsd + deltaCostUsd,
      costIsFinal: false,
    });
    this.emitChange();
  }

  setFinalTokenCostUsd(costUsd: number): void {
    const cur = this.$tokenUsage.get();
    this.$tokenUsage.set({ ...cur, costUsd, costIsFinal: true });
    this.emitChange();
  }

  setTasks(tasks: TaskItem[], emit = true): void {
    this.$tasks.set(tasks);
    if (emit) this.emitChange();
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

  /** No-op on identical text: an emit here means a network push downstream. */
  setHandoffText(text: string): void {
    if (this.$handoffText.get() === text) return;
    logToFile(`store.setHandoffText: ${text.length} chars`);
    this.$handoffText.set(text);
    this.emitChange();
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const incoming = todos.map((t) => {
      const status = isTaskStatus(t.status) ? t.status : TaskStatus.Pending;
      return {
        label: t.content,
        activeForm: t.activeForm,
        status,
        done: status === TaskStatus.Completed,
      };
    });
    const incomingLabels = new Set(incoming.map((t) => t.label));
    const retained = this.$tasks
      .get()
      .filter((t) => t.done && !incomingLabels.has(t.label));
    this.$tasks.set([...retained, ...incoming]);
    this.emitChange();
    this._onTasksChanged?.();
  }

  /** Register a listener for task state changes (e.g. task stream push). */
  set onTasksChanged(fn: () => void) {
    this._onTasksChanged = fn;
  }

  // ── What the agent waits on: questions, notices, settings ────────

  /** Record a wizard_ask request; the owner raises the interrupt and resolves it. */
  requestQuestion(question: PendingQuestion): Promise<AskAnswers> {
    if (this._resolvePendingQuestion) {
      throw new Error(
        'requestQuestion called while another wizard_ask request is pending',
      );
    }
    this.setKey('pendingQuestion', question, false);
    return new Promise<AskAnswers>((resolve) => {
      this._resolvePendingQuestion = resolve;
    });
  }

  /** Clear the request and hand the answers to the waiting agent. */
  resolvePendingQuestion(answers: AskAnswers): boolean {
    const resolve = this._resolvePendingQuestion;
    this._resolvePendingQuestion = null;
    this.setKey('pendingQuestion', null, false);
    resolve?.(answers);
    return resolve !== null;
  }

  showTaskNotice(notice: TaskNotice): Promise<boolean> {
    this.setKey('taskNotice', notice, false);
    return new Promise((resolve) => {
      this._resolveTaskNotice = resolve;
    });
  }

  resolveTaskNotice(keep: boolean): void {
    this.setKey('taskNotice', null, false);
    this._resolveTaskNotice?.(keep);
    this._resolveTaskNotice = null;
  }

  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    this.patchSession(
      {
        settingsOverrideKeys: conflicts.flatMap((c) => c.keys),
        settingsConflicts: conflicts,
      },
      false,
    );
    this._backupAndFixSettings = backupAndFix;
    return new Promise((resolve) => {
      this._resolveSettingsOverride = resolve;
    });
  }

  /** Back up .claude/settings.json; true means the overlay may close. */
  backupAndFixSettingsOverride(): boolean {
    const ok = this._backupAndFixSettings?.() ?? false;
    if (ok) {
      this.patchSession(
        { settingsOverrideKeys: null, settingsConflicts: null },
        false,
      );
      this._resolveSettingsOverride?.();
      this._resolveSettingsOverride = null;
      this._backupAndFixSettings = null;
    }
    return ok;
  }

  // ── Change notification ──────────────────────────────────────────

  getVersion(): number {
    return this.$version.get();
  }

  emitChange(): void {
    this.$version.set(this.$version.get() + 1);
  }

  subscribe(callback: () => void): () => void {
    return this.$version.listen(() => callback());
  }

  getSnapshot(): number {
    return this.$version.get();
  }
}
