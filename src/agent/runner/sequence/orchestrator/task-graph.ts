/**
 * A program's typed task graph, as the orchestrator receives it: resolved by
 * the caller, with its conditions already applied. The runner compares it to
 * the planner's graph, and when the flow's flag says so, rewires the queue to
 * it. Pure and store-reading only; nothing here knows a task type.
 */
import type { QueuedTask, QueueStore } from './queue';

export interface TaskGraphNode {
  /** The types this one runs after. A type with no queued task stands in for its own dependencies. */
  dependsOn: readonly string[];
  /** Match each dependency to the tasks of its type that share these input values, for a fanned-out chain. */
  matchInputs?: readonly string[];
  /** The graph does not decide whether it is queued: the planner or the caller does. */
  picked?: boolean;
}

export interface TaskGraph {
  /** The task that runs last and reports on the run. */
  sink: string;
  nodes: Readonly<Record<string, TaskGraphNode>>;
  /** Types the graph's conditions excluded from this run. */
  excluded: readonly string[];
}

/** How the planner's graph differs from the typed one, by type. Empty lists everywhere means they agree. */
export interface GraphDiff {
  /** Types the graph always queues that the planner did not. */
  missingTypes: string[];
  /** Queued types the graph does not have, or excluded. */
  extraTypes: string[];
  /** Per queued task, the types of the ancestor tasks one graph has and the other lacks. */
  edges: { type: string; missing: string[]; extra: string[] }[];
}

/** The node's dependency types, each absent type replaced by its own, recursively. */
function presentDependencyTypes(
  graph: TaskGraph,
  type: string,
  present: ReadonlySet<string>,
  seen: Set<string> = new Set(),
): string[] {
  const out: string[] = [];
  for (const dep of graph.nodes[type]?.dependsOn ?? []) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    if (present.has(dep)) out.push(dep);
    else out.push(...presentDependencyTypes(graph, dep, present, seen));
  }
  return [...new Set(out)];
}

function sharesInputs(
  a: QueuedTask,
  b: QueuedTask,
  keys: readonly string[] | undefined,
): boolean {
  return (keys ?? []).every(
    (key) =>
      a.inputs[key] === undefined ||
      b.inputs[key] === undefined ||
      a.inputs[key] === b.inputs[key],
  );
}

/** Each queued task's dependencies under the typed graph. A task whose type the graph lacks keeps its own. */
export function typedEdges(
  store: QueueStore,
  graph: TaskGraph,
): Map<string, string[]> {
  const tasks = store.list();
  const present = new Set(tasks.map((t) => t.type));
  const edges = new Map<string, string[]>();
  for (const task of tasks) {
    const node = graph.nodes[task.type];
    if (!node) {
      edges.set(task.id, [...task.dependsOn]);
      continue;
    }
    const depTypes = new Set(presentDependencyTypes(graph, task.type, present));
    edges.set(
      task.id,
      tasks
        .filter(
          (dep) =>
            dep.id !== task.id &&
            depTypes.has(dep.type) &&
            sharesInputs(task, dep, node.matchInputs),
        )
        .map((dep) => dep.id),
    );
  }
  return edges;
}

/** Every task id `id` runs after, transitively. */
function ancestorIds(
  id: string,
  edgesOf: (id: string) => readonly string[],
): Set<string> {
  const seen = new Set<string>();
  const visit = (current: string): void => {
    for (const dep of edgesOf(current)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      visit(dep);
    }
  };
  visit(id);
  return seen;
}

/** The planner's graph against the typed one. Ancestors, not direct edges, so a redundant edge is no difference. */
export function graphDiff(store: QueueStore, graph: TaskGraph): GraphDiff {
  const tasks = store.list();
  const present = new Set(tasks.map((t) => t.type));
  const excluded = new Set(graph.excluded);
  const typed = typedEdges(store, graph);
  const typeOf = (id: string) => store.get(id)?.type;

  const missingTypes = Object.entries(graph.nodes)
    .filter(([type, node]) => !node.picked && !present.has(type))
    .map(([type]) => type);
  const extraTypes = [...present].filter(
    (type) => !graph.nodes[type] || excluded.has(type),
  );
  const edges: GraphDiff['edges'] = [];
  for (const task of tasks) {
    if (!graph.nodes[task.type]) continue;
    const planned = ancestorIds(
      task.id,
      (id) => store.get(id)?.dependsOn ?? [],
    );
    const expected = ancestorIds(task.id, (id) => typed.get(id) ?? []);
    // By task, so a fanned-out chain wired to the wrong sibling counts; reported by type.
    const typesOf = (ids: string[]) =>
      [...new Set(ids.flatMap((id) => typeOf(id) ?? []))].sort();
    const missing = typesOf([...expected].filter((id) => !planned.has(id)));
    const extra = typesOf([...planned].filter((id) => !expected.has(id)));
    if (missing.length > 0 || extra.length > 0) {
      edges.push({ type: task.type, missing, extra });
    }
  }
  return { missingTypes, extraTypes, edges };
}

/** Whether a diff found nothing. */
export function graphsAgree(diff: GraphDiff): boolean {
  return (
    diff.missingTypes.length === 0 &&
    diff.extraTypes.length === 0 &&
    diff.edges.length === 0
  );
}
