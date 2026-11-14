/** The graph each flow's frontmatter declares, recorded and bundled: well formed, and posthog-integration's queues its planner's task sets. */
import fs from 'fs';
import path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

import { expandBundleEntry, type SkillMenu } from '@shared/skill-menu';
import {
  buildRegistry,
  type AgentPrompt,
} from '../../../../agent-prompt-loader';
import { planTaskGraph } from '../task-graph';
import {
  CONTEXT_MILL_FIXTURES,
  bundledFlows,
  recordedFlows,
} from './flow-prompts.no-jest';

const menu = JSON.parse(
  fs.readFileSync(path.join(CONTEXT_MILL_FIXTURES, 'skill-menu.json'), 'utf8'),
) as SkillMenu;
const menuNames = new Set(
  Object.values(menu.categories)
    .flat()
    .flatMap(expandBundleEntry)
    .flatMap((entry) => (entry.group ? [entry.group, entry.id] : [entry.id])),
);

const plan = (
  prompts: readonly AgentPrompt[],
  flow: string,
  exclude: string[] = [],
) => {
  const registry = buildRegistry(prompts, flow, { exclude });
  return planTaskGraph(registry.graph, (type) =>
    registry.enqueueableTypes.includes(type),
  );
};

const recorded = recordedFlows();
const bundled = bundledFlows();

it('bundles every recorded flow', () => {
  expect([...bundled.keys()]).toEqual(
    expect.arrayContaining([...recorded.keys()]),
  );
});

describe.each([
  ['recorded', recorded],
  ['bundled', bundled],
] as const)('the %s flows', (_, flows) => {
  describe.each([...flows.keys()])('%s', (flow) => {
    const tasks = (flows.get(flow) ?? []).filter((prompt) => !prompt.seed);
    const types = tasks.map((prompt) => prompt.type);

    it('names only its own tasks in dependsOn', () => {
      const unknown = tasks.flatMap((prompt) =>
        prompt.dependsOn
          .filter((dep) => !types.includes(dep))
          .map((dep) => `${prompt.type} -> ${dep}`),
      );
      expect(unknown).toEqual([]);
    });

    it('has one task that runs last', () => {
      expect(tasks.filter((prompt) => prompt.sink)).toHaveLength(1);
    });

    it('orders every task, with the last one a sink', () => {
      const planned = plan(flows.get(flow) ?? [], flow);
      const queueable = tasks.filter((prompt) => !prompt.runnerSeeded);
      expect(planned.map((task) => task.type).sort()).toEqual(
        queueable.map((prompt) => prompt.type).sort(),
      );
      const last = planned[planned.length - 1].type;
      expect(tasks.find((prompt) => prompt.type === last)?.sink).toBe(true);
    });

    it('names skills the recorded menu has', () => {
      const missing = tasks.flatMap((prompt) =>
        prompt.skills
          .filter((skill) => !menuNames.has(skill))
          .map((skill) => `${prompt.type}: ${skill}`),
      );
      expect(missing).toEqual([]);
    });
  });
});

describe('the bundled flows against the recorded ones', () => {
  const byType = (prompts: readonly AgentPrompt[] = []) =>
    Object.fromEntries(prompts.map((prompt) => [prompt.type, prompt]));
  const shared = [...bundled.keys()].filter((flow) => recorded.has(flow));

  it.each(shared.filter((flow) => flow !== 'integration-v2'))(
    '%s parses to the same prompts, planner included',
    (flow) => {
      expect(byType(bundled.get(flow))).toEqual(byType(recorded.get(flow)));
    },
  );

  it('integration-v2 parses to the same tasks, without the planner and with capture after MCP analytics', () => {
    const before = byType(recorded.get('integration-v2'));
    const after = byType(bundled.get('integration-v2'));
    expect(before['integrate-posthog'].seed).toBe(true);
    delete before['integrate-posthog'];
    expect(Object.values(after).filter((prompt) => prompt.seed)).toEqual([]);
    expect(after.capture.dependsOn).toEqual([
      ...before.capture.dependsOn,
      'mcp-analytics',
    ]);
    before.capture = { ...before.capture, dependsOn: after.capture.dependsOn };
    expect(after).toEqual(before);
  });
});

describe("posthog-integration's bundled graph", () => {
  const FLOW = 'integration-v2';
  const prompts = bundled.get(FLOW) ?? [];
  const CORE = [
    'capture',
    'dashboard',
    'error-tracking',
    'identify',
    'init',
    'install',
    'report',
    'review',
  ];
  const AIO_LOGS = ['ai-observability', 'logs'];
  const MCP = 'mcp-analytics';
  const types = (exclude: string[]) =>
    plan(prompts, FLOW, exclude)
      .map((task) => task.type)
      .sort();
  const edges = (exclude: string[]) =>
    Object.fromEntries(
      plan(prompts, FLOW, exclude).map((task) => [task.type, task.dependsOn]),
    );

  // The task sets the planner queues, by what the program excludes. `warehouse` is the wizard's own to queue.
  it.each([
    ['the default run', [MCP], [...CORE, ...AIO_LOGS]],
    ['a project with an MCP server', [], [...CORE, ...AIO_LOGS, MCP]],
    ['AI Observability and Logs off', [MCP, ...AIO_LOGS], CORE],
    ['both', AIO_LOGS, [...CORE, MCP]],
  ])("queues the planner's task set for %s", (_, exclude, expected) => {
    expect(types(exclude)).toEqual([...expected].sort());
  });

  it('declares the order the planner prompt describes', () => {
    expect(edges([])).toEqual({
      install: [],
      init: [],
      identify: ['install', 'init'],
      'error-tracking': ['install', 'init'],
      'mcp-analytics': ['install', 'init', 'identify'],
      capture: ['install', 'init', 'identify', 'mcp-analytics'],
      'ai-observability': ['capture'],
      logs: ['ai-observability'],
      dashboard: ['capture', 'mcp-analytics'],
      review: [
        'install',
        'init',
        'identify',
        'mcp-analytics',
        'error-tracking',
        'capture',
        'ai-observability',
        'logs',
      ],
      report: ['dashboard', 'review'],
    });
  });

  it('keeps the order around the tasks a run leaves out', () => {
    const left = edges([MCP, ...AIO_LOGS]);
    expect(left.capture).toEqual(['install', 'init', 'identify']);
    expect(left.dashboard).toEqual(['capture', 'install', 'init', 'identify']);
    expect(left.review).toEqual([
      'install',
      'init',
      'identify',
      'error-tracking',
      'capture',
    ]);
  });

  it('leaves warehouse to the wizard', () => {
    expect(types([])).not.toContain('warehouse');
  });
});
