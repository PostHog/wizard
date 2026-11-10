/** Queues a flow with no planner prompt from the graph its frontmatter declares; see the [README](../README.md#orchestrator). */
import type { GraphTask } from '../../../agent-prompt-loader';
import {
  applyEnqueue,
  uncoveredBySink,
  type OrchestratorToolsContext,
} from './queue-tools';
import type { QueuedTask } from './queue';

/** A task to queue, with the types it waits for. */
export interface PlannedTask {
  type: string;
  dependsOn: string[];
}

/** The tasks `keep` allows, each after every task it waits for and the sinks last. Throws when they cannot be ordered. */
export function planTaskGraph(
  graph: readonly GraphTask[],
  keep: (type: string) => boolean,
): PlannedTask[] {
  const declared = new Map(graph.map((task) => [task.type, task]));

  // What a task waits for among the kept tasks, reading through the dropped ones.
  const resolve = (type: string, through: Set<string>): string[] => {
    const resolved: string[] = [];
    for (const dep of declared.get(type)?.dependsOn ?? []) {
      if (!declared.has(dep)) continue;
      if (keep(dep)) resolved.push(dep);
      else if (!through.has(dep)) {
        resolved.push(...resolve(dep, new Set(through).add(dep)));
      }
    }
    return resolved;
  };

  const pending = graph
    .filter((task) => keep(task.type))
    .map((task) => ({
      type: task.type,
      sink: task.sink,
      dependsOn: [...new Set(resolve(task.type, new Set()))].filter(
        (dep) => dep !== task.type,
      ),
    }));

  const planned: PlannedTask[] = [];
  const queued = new Set<string>();
  // Sinks wait for the whole queue, so every other task is placed first.
  for (const sinks of [false, true]) {
    let waiting = pending.filter((task) => task.sink === sinks);
    while (waiting.length > 0) {
      const ready = waiting.filter((task) =>
        task.dependsOn.every((dep) => queued.has(dep)),
      );
      if (ready.length === 0) {
        throw new Error(
          `The task graph cannot be ordered: ${waiting
            .map((task) => task.type)
            .join(', ')} wait on each other, or on a task that runs last.`,
        );
      }
      for (const { type, dependsOn } of ready) {
        planned.push({ type, dependsOn });
        queued.add(type);
      }
      waiting = waiting.filter((task) => !queued.has(task.type));
    }
  }
  return planned;
}

/** Queues the graph through the guards `enqueue_task` passes; a sink also waits for every queued task its dependencies do not reach. */
export function queueTaskGraph(
  ctx: OrchestratorToolsContext,
  graph: readonly GraphTask[],
): QueuedTask[] {
  const ids = new Map<string, string>();
  const queued: QueuedTask[] = [];
  const plan = planTaskGraph(graph, (type) => ctx.validTypes.includes(type));
  for (const planned of plan) {
    const dependsOn = planned.dependsOn.flatMap((type) => ids.get(type) ?? []);
    for (const missed of uncoveredBySink(ctx, { ...planned, dependsOn })) {
      dependsOn.push(missed.id);
    }
    const result = applyEnqueue(ctx, {
      type: planned.type,
      dependsOn,
      reason: "Declared in the flow's frontmatter",
    });
    if (!result.ok) {
      throw new Error(
        `Cannot queue "${planned.type}" from the flow's frontmatter (${result.guard}): ${result.message}`,
      );
    }
    ids.set(planned.type, result.task.id);
    queued.push(result.task);
  }
  return queued;
}
