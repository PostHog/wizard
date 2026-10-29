import { describe, expect, it } from 'vitest';
import { WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY } from '@shared/constants';
import { PROGRAM_REGISTRY } from '../program-runner/program-registry';
import {
  resolveFlow,
  type FlowContext,
  type ProgramConfig,
} from '@programs/program-contract';

/** The frontmatter fields the graph must agree with. */
function parseAgentPromptFrontmatter(text: string, type: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const flag = (key: string) =>
    new RegExp(`^${key}:\\s*true\\b`, 'm').test(frontmatter);
  return {
    type,
    seed: flag('seed'),
    sink: flag('sink'),
    runnerSeeded: flag('runnerSeeded'),
  };
}

const NO_TRAITS: FlowContext = { traits: {}, flags: {} };

const FLOW_PROGRAMS = PROGRAM_REGISTRY.filter(
  (config): config is ProgramConfig & Required<Pick<ProgramConfig, 'flow'>> =>
    config.flow !== undefined,
);

/** Every type `type` runs after, transitively. */
function ancestors(
  nodes: Readonly<Record<string, { dependsOn: readonly string[] }>>,
  type: string,
): Set<string> {
  const seen = new Set<string>();
  const visit = (t: string) => {
    for (const dep of nodes[t]?.dependsOn ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      visit(dep);
    }
  };
  visit(type);
  return seen;
}

it('covers the five orchestrator flows', () => {
  expect(FLOW_PROGRAMS.map((c) => c.id).sort()).toEqual([
    'error-tracking',
    'feature-flags',
    'metrics',
    'posthog-integration',
    'replay-vision',
  ]);
});

describe.each(FLOW_PROGRAMS.map((c) => [c.id, c] as const))(
  '%s flow',
  (_, config) => {
    const graph = resolveFlow(config.flow, NO_TRAITS);

    it('has one node per task prompt, and the prompts mark the same sink', async () => {
      const prompts = Object.entries((await config.agentPrompts?.()) ?? {}).map(
        ([type, text]) => parseAgentPromptFrontmatter(text, type),
      );
      const tasks = prompts.filter((p) => !p.seed);
      expect(Object.keys(config.flow.nodes).sort()).toEqual(
        tasks.map((p) => p.type).sort(),
      );
      expect(tasks.filter((p) => p.sink).map((p) => p.type)).toEqual([
        config.flow.sink,
      ]);
    });

    it('is acyclic and every node reaches the sink', () => {
      for (const type of Object.keys(graph.nodes)) {
        expect(ancestors(graph.nodes, type).has(type)).toBe(false);
      }
      const reported = ancestors(graph.nodes, graph.sink);
      for (const type of Object.keys(graph.nodes)) {
        if (type !== graph.sink) expect(reported).toContain(type);
      }
    });

    it('lets nothing but the sink wait on a runner-seeded task', async () => {
      const seeded = Object.entries((await config.agentPrompts?.()) ?? {})
        .map(([type, text]) => parseAgentPromptFrontmatter(text, type))
        .filter((p) => p.runnerSeeded)
        .map((p) => p.type);
      for (const type of seeded) {
        expect(graph.nodes[type].picked).toBe(true);
        for (const other of Object.keys(graph.nodes)) {
          if (other === graph.sink || other === type) continue;
          expect(ancestors(graph.nodes, other)).not.toContain(type);
        }
      }
    });

    it('excludes what the program excludes, for every AIO/Logs flag value', () => {
      for (const value of [undefined, 'true', 'false', 'banana']) {
        const flags: Record<string, string> =
          value === undefined
            ? {}
            : { [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: value };
        expect(
          [...resolveFlow(config.flow, { traits: {}, flags }).excluded].sort(),
        ).toEqual([...(config.excludedTaskTypes?.(flags) ?? [])].sort());
      }
    });
  },
);

describe('posthog-integration flow', () => {
  const found = FLOW_PROGRAMS.find((c) => c.id === 'posthog-integration');
  if (!found) throw new Error('posthog-integration has no flow');
  const config = found;
  const graph = resolveFlow(config.flow, NO_TRAITS);
  const after = (type: string) => ancestors(graph.nodes, type);

  it('has the shape the integrate-posthog planner prompt describes', () => {
    expect(after('identify')).toEqual(new Set(['install', 'init']));
    expect(after('error-tracking')).toEqual(new Set(['install', 'init']));
    expect(after('capture')).toEqual(new Set(['install', 'init', 'identify']));
    expect(after('ai-observability')).toContain('capture');
    expect(after('ai-observability')).not.toContain('error-tracking');
    expect(after('logs')).toContain('ai-observability');
    expect(after('dashboard')).toEqual(after('capture').add('capture'));
    for (const type of [
      'install',
      'init',
      'identify',
      'capture',
      'error-tracking',
      'ai-observability',
      'logs',
    ]) {
      expect(after('review')).toContain(type);
    }
    expect(after('report')).toEqual(
      new Set(Object.keys(graph.nodes).filter((t) => t !== 'report')),
    );
  });

  it('puts the warehouse step after every task but the report', () => {
    expect(after('warehouse')).toEqual(
      new Set(
        Object.keys(graph.nodes).filter(
          (t) => t !== 'report' && t !== 'warehouse',
        ),
      ),
    );
  });

  it('drops AI Observability on a definite no, and Logs then follows capture', () => {
    const judged = resolveFlow(config.flow, {
      traits: { callsLlmApi: { value: 'no', source: 'static' } },
      flags: {},
    });
    expect(judged.excluded).toEqual(['ai-observability']);
    expect(judged.nodes.logs.dependsOn).toEqual(['capture']);
    expect(judged.nodes.review.dependsOn).not.toContain('ai-observability');
  });

  it('keeps AI Observability when the trait is absent or yes', () => {
    expect(resolveFlow(config.flow, NO_TRAITS).excluded).toEqual([]);
    expect(
      resolveFlow(config.flow, {
        traits: { callsLlmApi: { value: 'yes', source: 'static' } },
        flags: {},
      }).excluded,
    ).toEqual([]);
  });
});
