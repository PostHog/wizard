/** The graph each bundled flow's frontmatter declares: well formed, and posthog-integration's queues the task sets its runs need. */
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
import { CONTEXT_MILL_FIXTURES, bundledFlows } from './flow-prompts.no-jest';

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

const bundled = bundledFlows();

describe('the bundled flows', () => {
  describe.each([...bundled.keys()])('%s', (flow) => {
    const tasks = (bundled.get(flow) ?? []).filter((prompt) => !prompt.seed);
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
      const planned = plan(bundled.get(flow) ?? [], flow);
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

  // The task sets a run queues, by what the program excludes. `warehouse` is the wizard's own to queue.
  it.each([
    ['the default run', [MCP], [...CORE, ...AIO_LOGS]],
    ['a project with an MCP server', [], [...CORE, ...AIO_LOGS, MCP]],
    ['AI Observability and Logs off', [MCP, ...AIO_LOGS], CORE],
    ['both', AIO_LOGS, [...CORE, MCP]],
  ])('queues the task set for %s', (_, exclude, expected) => {
    expect(types(exclude)).toEqual([...expected].sort());
  });

  it('declares the order between its tasks', () => {
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
