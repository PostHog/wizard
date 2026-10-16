/**
 * A program's orchestrator flow as code: one node per task type, keyed by the
 * type, so a misspelled dependency fails the build. `resolveFlow` applies the
 * run's traits and flags and hands the orchestrator a `TaskGraph`.
 */

import type { TaskGraph } from '@agent/types';
import type { SkillCriteria } from '@shared/skill-resolution';
import type { Traits, TraitName } from './traits';

export type FlowContext = {
  traits: Traits;
  flags: Readonly<Record<string, string>>;
};

export type FlowNode<K extends string> = {
  /** The types this one runs after. A dropped or unqueued dependency stands in for its own. */
  dependsOn?: readonly K[];
  /** Match each dependency to the tasks of its type that share these input values. */
  matchInputs?: readonly string[];
  /** The planner or the caller decides whether it is queued, not the graph. */
  picked?: true;
  /** Runs only when this holds. A missing trait must read as "run the node". */
  when?: (ctx: FlowContext) => boolean;
  /** Traits `when` reads, so the run asks the questions behind them. */
  reads?: readonly TraitName[];
  /** The node's skills by criteria; until set, its prompt's frontmatter names them. */
  skills?: readonly SkillCriteria[];
};

export type Flow<K extends string = string> = {
  /** The task that runs last and reports on the run. */
  sink: K;
  nodes: { readonly [P in K]: FlowNode<K> };
};

/** Declare a flow; keys are task types, and every `dependsOn` and `sink` must name one. */
export function defineFlow<K extends string>(flow: Flow<K>): Flow<K> {
  return flow;
}

/** The flow for this run: nodes whose `when` fails are excluded, and their dependents inherit their edges. */
export function resolveFlow(flow: Flow, ctx: FlowContext): TaskGraph {
  const nodes = flow.nodes as Readonly<Record<string, FlowNode<string>>>;
  const excluded = Object.keys(nodes).filter(
    (type) => nodes[type].when?.(ctx) === false,
  );
  const dropped = new Set(excluded);
  const spliced = (type: string, seen = new Set<string>()): string[] =>
    (nodes[type]?.dependsOn ?? []).flatMap((dep) => {
      if (seen.has(dep)) return [];
      seen.add(dep);
      return dropped.has(dep) ? spliced(dep, seen) : [dep];
    });

  return {
    sink: flow.sink,
    excluded,
    nodes: Object.fromEntries(
      Object.keys(nodes)
        .filter((type) => !dropped.has(type))
        .map((type) => {
          const node = nodes[type];
          return [
            type,
            {
              dependsOn: [...new Set(spliced(type))],
              ...(node.matchInputs ? { matchInputs: node.matchInputs } : {}),
              ...(node.picked ? { picked: true } : {}),
            },
          ];
        }),
    ),
  };
}

/** Every trait a flow reads: its conditions' declared traits and its skill criteria's. */
export function flowTraits(flow: Flow): Set<TraitName> {
  const traits = new Set<TraitName>();
  for (const node of Object.values<FlowNode<string>>(flow.nodes)) {
    for (const trait of node.reads ?? []) traits.add(trait);
    for (const criteria of node.skills ?? []) {
      if (!('tags' in criteria)) continue;
      for (const trait of [
        ...(criteria.require ?? []),
        ...(criteria.prefer ?? []),
      ]) {
        traits.add(trait as TraitName);
      }
    }
  }
  return traits;
}
