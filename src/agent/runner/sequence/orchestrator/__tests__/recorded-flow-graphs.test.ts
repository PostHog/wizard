/** The graph each recorded flow's frontmatter declares: well formed, and posthog-integration's queues its planner's task sets. */
import fs from 'fs';
import path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

import { expandBundleEntry, type SkillMenu } from '@shared/skill-menu';
import { buildRegistry } from '../../../../agent-prompt-loader';
import { planTaskGraph } from '../task-graph';
import { CONTEXT_MILL_FIXTURES, recordedFlows } from './recorded-flows.no-jest';

const flows = recordedFlows();

const menu = JSON.parse(
  fs.readFileSync(path.join(CONTEXT_MILL_FIXTURES, 'skill-menu.json'), 'utf8'),
) as SkillMenu;
const menuNames = new Set(
  Object.values(menu.categories)
    .flat()
    .flatMap(expandBundleEntry)
    .flatMap((entry) => (entry.group ? [entry.group, entry.id] : [entry.id])),
);

const plan = (flow: string, exclude: string[] = []) => {
  const registry = buildRegistry(flows.get(flow) ?? [], flow, { exclude });
  return planTaskGraph(registry.graph, (type) =>
    registry.enqueueableTypes.includes(type),
  );
};

it('records every orchestrator flow', () => {
  expect([...flows.keys()].sort()).toEqual([
    'error-tracking',
    'feature-flags',
    'integration-v2',
    'metrics',
    'replay-vision',
    'support',
  ]);
});

describe.each([...flows.keys()])('the %s flow', (flow) => {
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
    const planned = plan(flow);
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

describe("posthog-integration's graph", () => {
  const FLOW = 'integration-v2';
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
    plan(FLOW, exclude)
      .map((task) => task.type)
      .sort();
  const edges = (exclude: string[]) =>
    Object.fromEntries(
      plan(FLOW, exclude).map((task) => [task.type, task.dependsOn]),
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
      capture: ['install', 'init', 'identify'],
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
