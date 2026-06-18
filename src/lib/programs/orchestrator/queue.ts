/**
 * The orchestrator task queue.
 *
 * In memory, synchronous, single-owner: one Node process drives the run, so
 * there is no locking. The queue imposes no execution policy — `nextRunnable`
 * returns every pending task whose dependencies are satisfied, and how many of
 * those run at once is decided by the task graph, not the queue.
 *
 * Every transition rewrites `<installDir>/.posthog-wizard/queue.json`, a small
 * file holding the whole queue, handoffs included. Today it is the run's
 * log and the report's source; later it is the resume point.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { writeJsonAtomic } from '../../../utils/atomic-ledger';

export const TaskStatus = {
  Pending: 'pending',
  Running: 'running',
  Done: 'done',
  Skipped: 'skipped',
  Failed: 'failed',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export interface QueuedTask {
  id: string;
  type: string;
  /** Human-readable label for the TUI, set by the enqueuing agent. */
  label?: string;
  status: TaskStatus;
  dependsOn: string[];
  inputs: Record<string, unknown>;
  model?: string;
  attempts: number;
  maxAttempts: number;
  /** The structured handoff the task reported on completion. */
  handoff?: TaskHandoff;
  /** 'orchestrator' for seeded tasks, or the id of the task that enqueued this one. */
  enqueuedBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: { type: string; message: string };
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
  /** A one-line summary of any unresolved conflict, surfaced in the outro. */
  conflict?: string;
}

export interface EnqueueInput {
  type: string;
  label?: string;
  inputs?: Record<string, unknown>;
  dependsOn?: string[];
  model?: string;
  maxAttempts?: number;
  enqueuedBy?: string;
}

export const QUEUE_DIR_NAME = '.posthog-wizard';
const DEFAULT_MAX_ATTEMPTS = 2;

function nowIso(): string {
  return new Date().toISOString();
}

export class QueueStore {
  private tasks: QueuedTask[] = [];

  readonly runId: string;
  readonly queuePath: string;

  constructor(installDir: string, runId: string) {
    this.runId = runId;
    const dir = path.join(installDir, QUEUE_DIR_NAME);
    this.queuePath = path.join(dir, 'queue.json');
    fs.mkdirSync(dir, { recursive: true });
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
    const doneIds = new Set(
      this.tasks
        .filter(
          (t) =>
            t.status === TaskStatus.Done || t.status === TaskStatus.Skipped,
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
   * True when no task is in progress and none can be started. Either everything
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
      createdAt: nowIso(),
    };
    this.tasks.push(task);
    this.reflect();
    return task;
  }

  start(id: string): QueuedTask {
    const t = this.require(id);
    t.status = TaskStatus.Running;
    t.startedAt = nowIso();
    t.attempts += 1;
    this.reflect();
    return t;
  }

  complete(id: string, handoff?: TaskHandoff): QueuedTask {
    return this.finish(id, TaskStatus.Done, handoff);
  }

  /** Terminal: the agent could not do the task. Not done, not failed. */
  skip(id: string, handoff?: TaskHandoff): QueuedTask {
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

  /** Put a failed/in-progress task back to pending for a retry within the run. */
  requeue(id: string): QueuedTask {
    const t = this.require(id);
    t.status = TaskStatus.Pending;
    t.startedAt = undefined;
    t.finishedAt = undefined;
    this.reflect();
    return t;
  }

  // ── Internals ───────────────────────────────────────────────────────

  private finish(
    id: string,
    status: 'done' | 'skipped' | 'failed',
    handoff?: TaskHandoff,
  ): QueuedTask {
    const t = this.require(id);
    if (handoff) t.handoff = handoff;
    t.status = status;
    t.finishedAt = nowIso();
    this.reflect();
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

  private require(id: string): QueuedTask {
    const t = this.get(id);
    if (!t) throw new Error(`No task ${id} in the queue`);
    return t;
  }
}
