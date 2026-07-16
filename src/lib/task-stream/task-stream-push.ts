/**
 * Task-stream push — subscribes to WizardStore, builds payloads,
 * and fans out async to all registered destinations.
 *
 * Behaviour:
 *   - `attach(store)`            subscribe to store changes
 *   - task updates               debounced 250ms (trailing edge)
 *   - phase transitions          flush immediately, bypass debounce
 *   - RunPhase.Idle              skipped (no push)
 *   - enabled === false          destination delivery is disabled
 *   - shutdown(timeoutMs)        cancel pending, flush terminal phase
 *                                with timeout, never throw
 *
 * Concurrency: only one fan-out at a time. Emits during an in-flight
 * push are coalesced — at most one follow-up push fires with the
 * latest state once the current one settles.
 */

import type { WizardStore, TaskItem } from '@ui/tui/store';
import { TaskStatus } from '@ui/wizard-ui';
import { RunPhase, OutroKind, type OutroData } from '@lib/wizard-session';
import {
  type TaskStreamDestination,
  type TaskStreamUpdate,
  type StreamTask,
  type TaskStreamError,
  StreamTaskStatus,
  StreamEvent,
} from './types';
import { EventPlanWatcher } from './event-plan-watcher';

/** Trailing-edge debounce window for non-phase-change emits. */
const DEBOUNCE_MS = 250;
/** Default shutdown timeout for the final terminal flush. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;

const STATUS_MAP: Record<TaskStatus, StreamTaskStatus> = {
  [TaskStatus.Pending]: StreamTaskStatus.Pending,
  [TaskStatus.InProgress]: StreamTaskStatus.InProgress,
  [TaskStatus.Completed]: StreamTaskStatus.Completed,
  // The stream has no skipped state; skipped is terminal, so report it resolved.
  [TaskStatus.Skipped]: StreamTaskStatus.Completed,
};

function buildTasks(items: TaskItem[]): StreamTask[] {
  return items.map((item, i) => ({
    id: String(i),
    title: item.label,
    status: STATUS_MAP[item.status] ?? StreamTaskStatus.Pending,
  }));
}

/** Drop ".SSSZ" → "Z" so session_id segments stay routing-safe. */
function secondPrecisionIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * `workflow_id` and `skill_id` end up unescaped in Redis pub/sub
 * channel names, so the backend rejects anything outside
 * `^[A-Za-z0-9_.-]{1,255}$` with a 400. All current values already
 * comply; this is defence in depth in case a future caller passes
 * something with `:`, spaces, or other separators.
 */
function sanitizeChannelId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 255);
}

function buildError(
  phase: RunPhase,
  outroData: OutroData | null,
): TaskStreamError | undefined {
  if (phase !== RunPhase.Error) return undefined;
  if (outroData?.kind === OutroKind.Error) {
    const message = outroData.message ?? outroData.body ?? 'Wizard run failed';
    return { type: 'wizard_error', message };
  }
  return { type: 'wizard_error', message: 'Wizard run failed' };
}

export interface TaskStreamPushOptions {
  store: WizardStore;
  programId: string;
  destinations: TaskStreamDestination[];
  /** Optional absolute event-plan path to load into the store once. */
  eventPlanPath?: string;
  /** When false, destination subscription/delivery remains disabled. */
  enabled?: boolean;
}

export class TaskStreamPush {
  private readonly store: WizardStore;
  private readonly destinations: TaskStreamDestination[];
  private readonly startedAt: string;
  private readonly programId: string;
  private readonly sessionId: string;
  private readonly eventPlanWatcher: EventPlanWatcher | null;

  private enabled: boolean;
  private created = false;
  private lastPushedPhase: RunPhase | null = null;

  private unsubscribe: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private needsAnotherPush = false;
  private shuttingDown = false;

  constructor(opts: TaskStreamPushOptions) {
    this.store = opts.store;
    this.programId = sanitizeChannelId(opts.programId);
    this.destinations = opts.destinations;
    this.enabled = opts.enabled ?? true;
    const startedAt = new Date();
    this.eventPlanWatcher = opts.eventPlanPath
      ? new EventPlanWatcher(this.store, opts.eventPlanPath)
      : null;
    this.startedAt = secondPrecisionIso(startedAt);
    // skillId may not be set yet — fall back to programId so the
    // session_id is stable for the whole run regardless of when the
    // program metadata is populated.
    const skillId = sanitizeChannelId(
      this.store.session.skillId ?? this.programId,
    );
    this.sessionId = `${this.programId}-${skillId}-${this.startedAt}`;
  }

  /**
   * Load the event plan and subscribe to store changes. Destination delivery
   * remains disabled when `enabled === false`, but the plan still populates the
   * store for local and headless consumers.
   */
  attach(store?: WizardStore): void {
    this.eventPlanWatcher?.start();
    if (!this.enabled) return;
    if (this.unsubscribe) return;
    const target = store ?? this.store;
    this.unsubscribe = target.subscribe(() => this.onStoreChange());
  }

  /** Stop subscribing. Does not flush. */
  detach(): void {
    this.eventPlanWatcher?.stop();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Cancel pending debounce, flush one final push if the current
   * phase is terminal, and resolve. Never throws. Bounded by
   * `timeoutMs` — if a destination hangs, this returns anyway.
   */
  async shutdown(
    timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ): Promise<void> {
    this.shuttingDown = true;
    this.eventPlanWatcher?.refresh();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.detach();
    if (!this.enabled) return;

    const phase = this.store.session.runPhase;
    const isTerminal = phase === RunPhase.Completed || phase === RunPhase.Error;
    if (!isTerminal) return;

    const flush = this.flush();
    if (timeoutMs <= 0) return;
    await Promise.race([
      flush,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /**
   * Imperative push — fires immediately regardless of phase. Kept as
   * the building block for both subscription-driven and direct calls.
   */
  async push(): Promise<void> {
    await this.flush();
  }

  // ── Internal ────────────────────────────────────────────────────

  private onStoreChange(): void {
    if (!this.enabled || this.shuttingDown) return;
    const phase = this.store.session.runPhase;
    if (phase === RunPhase.Idle) return;

    // A push is already in flight — coalesce. The in-flight push's
    // settle handler will trigger one follow-up with the latest state.
    if (this.inFlight) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.needsAnotherPush = true;
      return;
    }

    const phaseChanged = phase !== this.lastPushedPhase;
    if (phaseChanged) {
      // Phase transitions bypass the debounce: the web app needs to
      // see Running → Completed as soon as it lands.
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      void this.flush();
      return;
    }

    // Task updates can arrive faster than we want to push. Debounce
    // them — the last update in a burst wins.
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  /**
   * Fan out the current state to every destination. Serialized — if
   * a flush is already running, mark "needs another" and let the
   * in-flight one schedule the follow-up when it settles.
   */
  private flush(): Promise<void> {
    if (this.inFlight) {
      this.needsAnotherPush = true;
      return this.inFlight;
    }

    const run = async (): Promise<void> => {
      try {
        await this.sendOnce();
      } finally {
        this.inFlight = null;
        if (this.needsAnotherPush) {
          this.needsAnotherPush = false;
          // Re-enter to push the latest snapshot.
          await this.flush();
        }
      }
    };

    this.inFlight = run();
    return this.inFlight;
  }

  private async sendOnce(): Promise<void> {
    const { session, tasks, eventPlan } = this.store;
    const skillId = sanitizeChannelId(session.skillId ?? this.programId);
    const phase = session.runPhase;

    const payload: TaskStreamUpdate = {
      session_id: this.sessionId,
      workflow_id: this.programId,
      skill_id: skillId,
      started_at: this.startedAt,
      run_phase: phase,
      tasks: buildTasks(tasks),
      event_plan: eventPlan.length > 0 ? { events: eventPlan } : undefined,
      error: buildError(phase, session.outroData),
      timestamp: new Date().toISOString(),
    };

    let event: StreamEvent;
    if (!this.created) {
      this.created = true;
      event = StreamEvent.Create;
    } else if (phase === RunPhase.Completed) {
      event = StreamEvent.Complete;
    } else if (phase === RunPhase.Error) {
      event = StreamEvent.Error;
    } else {
      event = StreamEvent.Update;
    }

    this.lastPushedPhase = phase;

    await Promise.all(
      this.destinations.map((d) =>
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        d.send(event, payload).catch(() => {}),
      ),
    );
  }
}
