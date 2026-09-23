/**
 * Where a runner-seeded task sits in the planner's graph.
 *
 * A runner-seeded task is queued from what the wizard detected, before the
 * planner runs (see `ProgramConfig.seedTasks`). At that moment the tasks it
 * should wait for do not exist, so it cannot name them: it is enqueued with no
 * dependencies and is therefore runnable in the first drain tier, alongside the
 * first coding tasks. For a task that stops to ask the user for credentials that
 * is the wrong place — the questions land while the coding agents are still
 * mid-flight.
 *
 * This module answers "what should it wait for?" once the planner has seeded the
 * queue. The task's agent prompt names the types it follows (`dependsOn` in
 * frontmatter); a prompt that names none waits for everything that is not the
 * sink, which puts it last but still ahead of the reporting step.
 *
 * Pure and store-reading only — the runner applies what this returns, and the
 * queue enforces the DAG.
 */
import type { QueuedTask, QueueStore } from './queue';
import { dependencyClosure } from './queue-tools';

export interface SeededDepsResult {
  /** Ids the seeded task should be made to wait for. */
  depIds: string[];
  /**
   * Declared types with no task of that type in the queue — the planner chose
   * not to queue one. Not an error: the edge is simply dropped, and the task
   * still runs after whatever else was declared.
   */
  unresolvedTypes: string[];
  /** Whether the ids came from the prompt's declared types or from the default. */
  declared: boolean;
}

/**
 * Resolve a runner-seeded task's dependencies against the planned queue.
 *
 * Two exclusions apply to both the declared and the default path:
 *
 * - **Sinks are never dependencies.** A sink runs last and must depend on the
 *   whole queue, this task included. Depending on it back would invert the edge
 *   and cost the report this task's `reportSection`. Leaving sinks out means a
 *   planner that forgot the sink→seeded edge is still caught by the sink
 *   invariant check rather than silently papered over here.
 * - **Anything already downstream of this task is never a dependency**, which is
 *   what makes the result cycle-free by construction rather than by the queue's
 *   per-edge refusal.
 */
export function seededDependencies(
  store: QueueStore,
  seededTaskId: string,
  declaredTypes: readonly string[],
  sinkTypes: readonly string[],
): SeededDepsResult {
  const eligible = store.list().filter((task) => {
    if (task.id === seededTaskId) return false;
    if (sinkTypes.includes(task.type)) return false;
    // Downstream of us already (the planner hung it off this task): depending on
    // it would close a loop.
    return !dependencyClosure(store, [task.id]).has(seededTaskId);
  });

  if (declaredTypes.length === 0) {
    return {
      depIds: eligible.map((t) => t.id),
      unresolvedTypes: [],
      declared: false,
    };
  }

  const depIds: string[] = [];
  const unresolvedTypes: string[] = [];
  for (const type of declaredTypes) {
    // Against the whole queue, not just `eligible` — a declared type that was
    // queued but is downstream of us was resolved, just not usable as an edge.
    // Only a type the planner never queued at all is unresolved.
    if (!store.list().some((t) => t.type === type)) {
      unresolvedTypes.push(type);
      continue;
    }
    for (const task of eligible) {
      // Every task of the type, so a fanned-out step (one `capture` per event)
      // is waited for in full rather than by its first task alone.
      if (task.type === type && !depIds.includes(task.id)) depIds.push(task.id);
    }
  }

  return { depIds, unresolvedTypes, declared: true };
}

/** What deferring one seeded task did, for the runner to log and report. */
export interface DeferredSeededTask {
  type: string;
  /** Types the prompt declared; empty when it fell back to the default. */
  declaredTypes: string[];
  declared: boolean;
  /** Edges actually added to the queue. */
  added: string[];
  /**
   * Edges the queue refused — a cycle or an unknown id. Always empty in a
   * healthy run: this resolver already excludes both, so anything here means the
   * two disagree and is worth a telemetry look.
   */
  refused: string[];
  unresolvedTypes: string[];
}

/**
 * Give every runner-seeded task the dependencies it could not name at enqueue,
 * and report what happened per task.
 *
 * The runner calls this once, after the planner has seeded the queue and before
 * the sink invariant is checked. Kept here rather than inline in the runner so
 * the wiring — which prompt's types feed which task — is testable without
 * standing up a whole run.
 */
export function deferSeededTasks(
  store: QueueStore,
  seededTasks: readonly QueuedTask[],
  declaredTypesFor: (type: string) => readonly string[],
  sinkTypes: readonly string[],
): DeferredSeededTask[] {
  return seededTasks.map((seeded) => {
    const declaredTypes = [...declaredTypesFor(seeded.type)];
    const resolved = seededDependencies(
      store,
      seeded.id,
      declaredTypes,
      sinkTypes,
    );
    const { added, refused } = store.addDependencies(
      seeded.id,
      resolved.depIds,
    );
    return {
      type: seeded.type,
      declaredTypes,
      declared: resolved.declared,
      added,
      refused,
      unresolvedTypes: resolved.unresolvedTypes,
    };
  });
}
