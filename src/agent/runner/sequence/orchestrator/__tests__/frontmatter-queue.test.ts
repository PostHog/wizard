/** A flow with no planner prompt is queued from its frontmatter; one with a planner prompt keeps its planner. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));
vi.mock('@shared/skill-menu', () => ({
  fetchSkillMenu: () => Promise.resolve(null),
}));
vi.mock('../../../switchboard', async () => {
  const { VALID_MODELS } = await import('../../../switchboard/models');
  return {
    resolveHarness: () => ({ harness: 'pi', model: [...VALID_MODELS][0] }),
    resolveStageOverrides: () => ({}),
    areSeededTasksEnabled: () => seededTasks,
    isAgentDagSkillsEnabled: () => false,
    getHarness: () => ({ runTask: (inputs: unknown) => harnessRun(inputs) }),
  };
});
import { ErrorCodes } from '@shared/errors';
import { analytics } from '@utils/analytics';
import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';

const FLOW: Record<string, string> = {
  report: '---\nsink: true\ndependsOn: [capture]\n---\nreport',
  capture: '---\ndependsOn: [install, logs]\n---\ncapture',
  logs: '---\ndependsOn: [install]\noptional: true\n---\nlogs',
  install: '---\ndependsOn: []\n---\ninstall',
  warehouse: '---\nrunnerSeeded: true\n---\nwarehouse',
};
const PLANNER = '---\nseed: true\n---\nplan';

type Inputs = {
  emit: (event: { kind: 'handoff'; text: string }) => void;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

let seededTasks = false;
let bundleFails = false;
let bundled: Record<string, string> | undefined;
let ran: string[] = [];
let queue: QueueStore | undefined;

/** The fake harness: a planner queues install then report, and every task completes. */
function harnessRun(raw: unknown) {
  const inputs = raw as Inputs;
  const { store } = inputs.orchestrator;
  const type = inputs.analyticsProperties.task_type;
  queue = store;
  ran.push(type);
  if (type === 'seed') {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report', dependsOn: [install.id] });
  } else {
    if (type === 'report') inputs.emit({ kind: 'handoff', text: '# Report' });
    store.complete(inputs.analyticsProperties.task_id as string);
  }
  return Promise.resolve({ kind: 'success' as const });
}

describe('queueing a flow from its frontmatter', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmatter-queue-'));
    seededTasks = false;
    bundleFails = false;
    bundled = FLOW;
    ran = [];
    queue = undefined;
    vi.mocked(analytics.wizardCapture).mockClear();
    vi.mocked(analytics.setTag).mockClear();
    vi.mocked(analytics.captureException).mockClear();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (excluded: string[] = []) =>
    runOrchestrator({
      config: {
        programId: 'flow',
        wizardFlags: {},
        wizardFlagPayloads: {},
        switchboard: {},
        excludedTaskTypes: () => excluded,
        agentPrompts:
          bundled &&
          (() =>
            bundleFails
              ? Promise.reject(new Error('Cannot find module'))
              : Promise.resolve(bundled)),
        seedTasks: () => [{ type: 'warehouse' }],
      },
      input: { installDir: dir, flags: { ci: true } },
      boot: {
        skillsBaseUrl: 'https://skills.test',
        wizardFlags: {},
        credentials: {
          projectId: 1,
          projectApiKey: 'phc_test',
          host: {
            apiHost: 'https://us.posthog.test',
            appHost: 'https://us.posthog.test',
          },
        },
      },
      emit: vi.fn(),
      interaction: undefined,
    } as unknown as SequenceContext);

  const seeded = () =>
    vi
      .mocked(analytics.wizardCapture)
      .mock.calls.find(([event]) => event === 'orchestrator seeded')?.[1];

  it('runs the bundled tasks in order, with no planner', async () => {
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(ran).toEqual(['install', 'logs', 'capture', 'report']);
    expect(seeded()).toEqual({
      task_count: 4,
      types: ['install', 'logs', 'capture', 'report'],
      source: 'frontmatter',
    });
  });

  it("leaves out the run's excluded tasks and keeps the order around them", async () => {
    const result = await run(['logs']);
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(ran).toEqual(['install', 'capture', 'report']);
    const capture = queue?.list().find((task) => task.type === 'capture');
    const install = queue?.list().find((task) => task.type === 'install');
    expect(capture?.dependsOn).toEqual([install?.id]);
  });

  it('runs a task the wizard queued first after the bundled tasks, and the report after it', async () => {
    seededTasks = true;
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(ran).toEqual(['install', 'logs', 'capture', 'warehouse', 'report']);
    const idOf = (type: string) =>
      queue?.list().find((task) => task.type === type)?.id;
    const waitsFor = (type: string) =>
      queue?.list().find((task) => task.type === type)?.dependsOn ?? [];
    expect([...waitsFor('warehouse')].sort()).toEqual(
      [idOf('install'), idOf('logs'), idOf('capture')].sort(),
    );
    expect(waitsFor('report')).toContain(idOf('warehouse'));
    expect(seeded()).toEqual({
      task_count: 5,
      types: ['warehouse', 'install', 'logs', 'capture', 'report'],
      source: 'frontmatter',
    });
  });

  it('fails with its own code when the bundled graph cannot be ordered', async () => {
    bundled = { ...FLOW, install: '---\ndependsOn: [capture]\n---\ninstall' };
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.code).toBe(ErrorCodes.AgentOrchestratorTaskGraph);
    expect(result.failure?.message).not.toContain('wait on each other');
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'orchestrator task graph rejected',
      { reason: 'unorderable' },
    );
    expect(ran).toEqual([]);
  });

  it('fails a run whose frontmatter leaves nothing to queue, without naming a planning step', async () => {
    const result = await run(['install', 'logs', 'capture', 'report']);
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.code).toBe(ErrorCodes.AgentOrchestratorHollowRun);
    expect(result.failure?.message).not.toContain('planning step');
    expect(ran).toEqual([]);
  });

  it('keeps the planner of a bundled flow that has a planner prompt', async () => {
    bundled = { ...FLOW, plan: PLANNER };
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(ran).toEqual(['seed', 'install', 'report']);
    expect(seeded()).toMatchObject({ source: 'planner' });
  });

  it('fails the run, and reports it, when the bundle fails to load', async () => {
    bundleFails = true;
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.code).toBe(ErrorCodes.AgentOrchestratorNoPlanner);
    expect(ran).toEqual([]);
    expect(analytics.captureException).toHaveBeenCalledWith(expect.any(Error), {
      step: 'orchestrator_bundled_prompts',
    });
  });

  it('fails a program that bundles no prompts with the same code', async () => {
    bundled = undefined;
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.code).toBe(ErrorCodes.AgentOrchestratorNoPlanner);
    expect(result.failure?.message).not.toContain('seed');
    expect(ran).toEqual([]);
  });
});
