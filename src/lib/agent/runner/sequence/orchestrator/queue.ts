/**
 * The orchestrator task queue.
 *
 * In memory, synchronous, single-owner: one Node process drives the run, so
 * there is no locking. The queue imposes no execution policy — `nextRunnable`
 * returns every pending task whose dependencies are satisfied, and how many of
 * those run at once is decided by the task graph, not the queue.
 *
 * Every transition rewrites `<installDir>/.posthog-wizard-cache/queue.json`, a
 * small file holding the whole queue, handoffs included. It is the run's log
 * and the report's source. The whole cache folder is run-scoped and wiped when
 * the run ends.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { writeJsonAtomic } from '@utils/atomic-ledger';
import { analytics } from '@utils/analytics';

export const TaskStatus = {
  Pending: 'pending',
  Running: 'running',
  Done: 'done',
  Skipped: 'not needed',
  Failed: 'failed',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * Why a task ended as skipped.
 *
 * A skip has several causes that look identical from outside: an agent finding
 * the step does not apply, a user declining it, and an offer nobody answered.
 * They mean opposite things — the first is a no-op, the last two are the user
 * telling us something — and telling them apart needs the reason recorded at
 * the moment of the skip, not inferred later from timings.
 *
 * Recorded on the task like `error` is on a failed one, so it reaches the
 * skipped-task event and the run's queue.json alike.
 */
export const SkipReason = {
  /** The user answered the step's notice with Skip. */
  UserDeclined: 'user-declined',
  /** The notice went unanswered until it timed out. */
  NoticeTimeout: 'notice-timeout',
  /** The notice could not be shown at all, so consent failed closed. */
  NoticeError: 'notice-error',
  /** The task agent reported `not needed`. See {@link NotNeededReason} for why. */
  AgentNotNeeded: 'agent-not-needed',
} as const;

export type SkipReason = (typeof SkipReason)[keyof typeof SkipReason];

/**
 * Why the agent itself reported `not needed`.
 *
 * {@link SkipReason.AgentNotNeeded} records who decided the skip, not what they
 * decided. `complete_task` offers `not needed` both for "the step does not
 * apply" and for "you cannot do it", so an agent that never got a credential
 * out of the user lands in the same bucket as one that found nothing to
 * connect — and the bucket is named after the first meaning. For the one step
 * that stops to ask for credentials, that is the difference that matters: a
 * step nobody supplied a password for is not a step that did not apply.
 *
 * A sub-dimension of the skip reason, never a replacement for it, so every
 * existing reason value keeps counting exactly what it counted before.
 */
export const NotNeededReason = {
  /** Nothing to do: the step genuinely does not apply to this project. */
  NotApplicable: 'not-applicable',
  /** The user was asked and declined, or left the prompts unanswered. */
  UserDeclined: 'user-declined',
  /** Something outside the run stopped it — a credential, plan, or endpoint. */
  Blocked: 'blocked',
} as const;

export type NotNeededReason =
  (typeof NotNeededReason)[keyof typeof NotNeededReason];

/**
 * Whether a value names a reason. The pi harness hands tool arguments over
 * unvalidated, so an invented value would otherwise reach the analytics
 * dimension as free text — the one thing this step must never emit.
 */
export function isNotNeededReason(value: unknown): value is NotNeededReason {
  return (Object.values(NotNeededReason) as unknown[]).includes(value);
}

export interface QueuedTask {
  id: string;
  type: string;
  /** Human-readable label for the TUI, set by the enqueuing agent. */
  label?: string;
  status: TaskStatus;
  /**
   * Ids of tasks that must finish before this one runs. Ids are generated at
   * enqueue, so a task can only depend on tasks created before it — the graph is
   * a DAG by construction, cycles cannot form. Unknown ids are rejected by the
   * enqueue_task guard.
   *
   * One sanctioned exception: {@link QueueStore.addDependencies} adds edges to a
   * still-pending task, for a runner-seeded task that was queued before the
   * planner ran and so could not name its dependencies then. It is additive,
   * pending-only, and cycle-checked per edge, so the DAG property above still
   * holds. Nothing else mutates this field.
   */
  dependsOn: string[];
  inputs: Record<string, unknown>;
  model?: string;
  attempts: number;
  maxAttempts: number;
  /** The structured handoff the task reported on completion. */
  handoff?: TaskHandoff;
  /** 'orchestrator' for seeded tasks, or the id of the task that enqueued this one. */
  enqueuedBy: string;
  /** Wizard-seeded only: terminal failure unblocks dependents and never fails the run. */
  optional?: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: { type: string; message: string };
  /** Set when `status` is `not needed`: why. The failed-task `error` of a skip. */
  skipReason?: SkipReason;
  /** Set only for an agent-reported skip, and only when the agent declared it. */
  notNeededReason?: NotNeededReason;
}

export interface QueueFile {
  version: 1;
  runId: string;
  tasks: QueuedTask[];
}

/** The structured handoff a task leaves for the next agent. */
export interface TaskHandoff {
  goals: string;
  did: string;
  forNextAgent: string;
  filesTouched?: string[];
  /** How the agent knows it worked — what it ran or observed. */
  evidence?: string;
  /** What the agent assumed about the app and could not verify. */
  assumptions?: string;
  /** A one-line summary of any unresolved conflict, surfaced in the outro. */
  conflict?: string;
  /** A finished section for the run's report, written by the task that owns the subject. */
  reportSection?: string;
}

export interface EnqueueInput {
  type: string;
  label?: string;
  inputs?: Record<string, unknown>;
  dependsOn?: string[];
  model?: string;
  maxAttempts?: number;
  enqueuedBy?: string;
  optional?: boolean;
}

export const QUEUE_DIR_NAME = '.posthog-wizard-cache';
const DEFAULT_MAX_ATTEMPTS = 2;

function nowIso(): string {
  return new Date().toISOString();
}

/** Dropped in the cache folder so an orphaned copy explains itself. */
const DELETE_ME_FILE = '.DELETE-ME.md';
const DELETE_ME_BODY = `# Safe to delete

This folder contains run artifacts from the PostHog Wizard. This should have
been deleted if the Wizard has finished running. If this wasn't deleted for
some reason, you can safely delete the entire \`${QUEUE_DIR_NAME}/\` folder.
`;

/** Every queue transition, in the order it is reflected. */
export type TransitionEvent =
  | 'enqueue'
  | 'start'
  | 'complete'
  | 'skip'
  | 'fail'
  | 'requeue';

export interface QueueStoreOptions {
  /**
   * Called on every transition with the task's post-transition state. The
   * runner uses it for telemetry; the store itself stays analytics-free.
   * Listener errors are reported but cannot break a transition.
   */
  onTransition?: (event: TransitionEvent, task: QueuedTask) => void;
}

export class QueueStore {
  private tasks: QueuedTask[] = [];
  private readonly onTransition?: (
    event: TransitionEvent,
    task: QueuedTask,
  ) => void;

  readonly runId: string;
  readonly queuePath: string;

  constructor(installDir: string, runId: string, opts?: QueueStoreOptions) {
    this.onTransition = opts?.onTransition;
    this.runId = runId;
    const dir = path.join(installDir, QUEUE_DIR_NAME);
    this.queuePath = path.join(dir, 'queue.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, DELETE_ME_FILE), DELETE_ME_BODY);
  }

  // ── Reads ───────────────────────────────────────────────────────────

  list(): readonly QueuedTask[] {
    return this.tasks;
  }

  get(id: string): QueuedTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /**
   * Every pending task whose dependencies are all satisfied (`done` or
   * `skipped`). A skipped dependency does not block downstream work.
   */
  nextRunnable(): QueuedTask[] {
    // A TERMINALLY failed optional dep satisfies like skipped; retryable failure still blocks.
    const doneIds = new Set(
      this.tasks
        .filter(
          (t) =>
            t.status === TaskStatus.Done ||
            t.status === TaskStatus.Skipped ||
            (t.status === TaskStatus.Failed &&
              t.optional === true &&
              t.attempts >= t.maxAttempts),
        )
        .map((t) => t.id),
    );
    return this.tasks.filter(
      (t) =>
        t.status === TaskStatus.Pending &&
        t.dependsOn.every((d) => doneIds.has(d)),
    );
  }

  /**
   * True when no task is running and none can be started. Either everything
   * is terminal, or the only pending tasks are blocked by a failed dependency.
   */
  isDrained(): boolean {
    if (this.tasks.some((t) => t.status === TaskStatus.Running)) return false;
    return this.nextRunnable().length === 0;
  }

  summary(): Record<TaskStatus, number> & { total: number } {
    const counts: Record<TaskStatus, number> = {
      [TaskStatus.Pending]: 0,
      [TaskStatus.Running]: 0,
      [TaskStatus.Done]: 0,
      [TaskStatus.Skipped]: 0,
      [TaskStatus.Failed]: 0,
    };
    for (const t of this.tasks) counts[t.status] += 1;
    return { ...counts, total: this.tasks.length };
  }

  readHandoff(id: string): TaskHandoff | null {
    return this.get(id)?.handoff ?? null;
  }

  /** Handoffs of completed tasks of a given type, oldest first. */
  readHandoffsByType(type: string): TaskHandoff[] {
    return this.tasks
      .filter((t) => t.type === type && t.handoff)
      .map((t) => t.handoff as TaskHandoff);
  }

  // ── Transitions (each one reflected to queue.json) ──────────────────

  enqueue(input: EnqueueInput): QueuedTask {
    const task: QueuedTask = {
      id: randomUUID(),
      type: input.type,
      label: input.label,
      status: TaskStatus.Pending,
      dependsOn: input.dependsOn ?? [],
      inputs: input.inputs ?? {},
      model: input.model,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      enqueuedBy: input.enqueuedBy ?? 'orchestrator',
      optional: input.optional,
      createdAt: nowIso(),
    };
    this.tasks.push(task);
    this.reflect();
    this.notify('enqueue', task);
    return task;
  }

  /**
   * Add dependency edges to a pending task — the one sanctioned exception to
   * `dependsOn` being immutable (see the field's doc).
   *
   * A runner-seeded task is enqueued before the planner runs, so the tasks it
   * should wait for do not exist yet and it cannot name them. This closes that
   * gap once, between planning and the drain.
   *
   * Three rules keep the graph a DAG: additive only (never removes an edge),
   * pending only (a task that already started keeps the graph it ran under), and
   * every edge cycle-checked — a dep that already reaches this task through its
   * own chain is refused. Refusals come back in the result rather than throwing:
   * one bad edge is a bug worth reporting, not a reason to end a run that is
   * otherwise fine.
   */
  addDependencies(
    id: string,
    depIds: readonly string[],
  ): { added: string[]; refused: string[] } {
    const task = this.require(id);
    if (task.status !== TaskStatus.Pending) {
      return { added: [], refused: [...depIds] };
    }

    const added: string[] = [];
    const refused: string[] = [];
    for (const depId of depIds) {
      // Already an edge, or a self-loop: nothing to do and nothing wrong.
      if (depId === id || task.dependsOn.includes(depId)) continue;
      // Checked against the graph as it stands, so two edges added in one call
      // cannot together form a cycle the first check missed.
      if (!this.get(depId) || this.reaches(depId, id)) {
        refused.push(depId);
        continue;
      }
      task.dependsOn.push(depId);
      added.push(depId);
    }
    if (added.length > 0) this.reflect();
    return { added, refused };
  }

  start(id: string): QueuedTask {
    const t = this.require(id);
    t.status = TaskStatus.Running;
    t.startedAt = nowIso();
    t.attempts += 1;
    this.reflect();
    this.notify('start', t);
    return t;
  }

  complete(id: string, handoff?: TaskHandoff): QueuedTask {
    return this.finish(id, TaskStatus.Done, handoff);
  }

  /**
   * Terminal: the task was not done, and that is not a failure.
   *
   * The reason is required, and sits before the optional handoff for that
   * reason. A skip carrying no reason is what let a five-minute auto-decline
   * hide inside the same event as an agent deciding a step did not apply.
   *
   * `notNeededReason` splits the agent-reported reason one level further; only
   * an agent supplies it, and only when it declared one.
   */
  skip(
    id: string,
    reason: SkipReason,
    handoff?: TaskHandoff,
    notNeededReason?: NotNeededReason,
  ): QueuedTask {
    const t = this.require(id);
    t.skipReason = reason;
    if (notNeededReason) t.notNeededReason = notNeededReason;
    return this.finish(id, TaskStatus.Skipped, handoff);
  }

  fail(
    id: string,
    error: { type: string; message: string },
    handoff?: TaskHandoff,
  ): QueuedTask {
    const t = this.require(id);
    t.error = error;
    return this.finish(id, TaskStatus.Failed, handoff);
  }

  /** Put a failed/running task back to pending for a retry within the run. */
  requeue(id: string): QueuedTask {
    const t = this.require(id);
    t.status = TaskStatus.Pending;
    t.startedAt = undefined;
    t.finishedAt = undefined;
    this.reflect();
    this.notify('requeue', t);
    return t;
  }

  // ── Internals ───────────────────────────────────────────────────────

  private finish(
    id: string,
    status: 'done' | 'not needed' | 'failed',
    handoff?: TaskHandoff,
  ): QueuedTask {
    const t = this.require(id);
    if (handoff) t.handoff = handoff;
    t.status = status;
    t.finishedAt = nowIso();
    this.reflect();
    this.notify(
      status === TaskStatus.Done
        ? 'complete'
        : status === TaskStatus.Skipped
        ? 'skip'
        : 'fail',
      t,
    );
    return t;
  }

  private reflect(): void {
    const file: QueueFile = {
      version: 1,
      runId: this.runId,
      tasks: this.tasks,
    };
    writeJsonAtomic(this.queuePath, file);
  }

  private notify(event: TransitionEvent, task: QueuedTask): void {
    try {
      this.onTransition?.(event, task);
    } catch (error) {
      // A listener must never break a transition, but its failure is a bug.
      analytics.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { step: 'orchestrator_queue_listener', event },
      );
    }
  }

  /** Whether `fromId` reaches `targetId` by following dependsOn edges. */
  private reaches(fromId: string, targetId: string): boolean {
    const seen = new Set<string>();
    const stack = [fromId];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (current === targetId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(this.get(current)?.dependsOn ?? []));
    }
    return false;
  }

  private require(id: string): QueuedTask {
    const t = this.get(id);
    if (!t) throw new Error(`No task ${id} in the queue`);
    return t;
  }
}
