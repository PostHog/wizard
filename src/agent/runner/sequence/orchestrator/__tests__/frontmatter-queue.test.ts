/** With `wizard-agent-dag` on, a flow with no planner prompt is queued from its frontmatter; one with a planner prompt keeps its planner. */
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
    isAgentDagEnabled: () => agentDag,
    getHarness: () => ({ runTask: (inputs: unknown) => harnessRun(inputs) }),
  };
});
vi.mock('../../../../agent-prompt-loader', async (importActual) => {
  const actual = await importActual<
    typeof import('../../../../agent-prompt-loader')
  >();
  const prompt = (type: string) =>
    actual.parseAgentPrompt(`---\ntype: ${type}\n---\n${type}`, type, 'flow');
  return {
    ...actual,
    loadAgentRegistry: (_url: string, _flow: string, opts?: object) =>
      Promise.resolve(
        actual.buildRegistry(
          [
            ...(withPlanner ? [{ ...prompt('plan'), seed: true }] : []),
            { ...prompt('report'), sink: true, dependsOn: ['capture'] },
            { ...prompt('capture'), dependsOn: ['install', 'logs'] },
            { ...prompt('logs'), dependsOn: ['install'], optional: true },
            { ...prompt('install'), dependsOn: installWaitsFor },
            { ...prompt('warehouse'), runnerSeeded: true },
          ],
          'flow',
          opts,
        ),
      ),
  };
});

import { ErrorCodes } from '@shared/errors';
import { analytics } from '@utils/analytics';
import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';

type Inputs = {
  emit: (event: { kind: 'handoff'; text: string }) => void;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

let agentDag = true;
let withPlanner = false;
let seededTasks = false;
let installWaitsFor: string[] = [];
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
    agentDag = true;
    withPlanner = false;
    seededTasks = false;
    installWaitsFor = [];
    ran = [];
    queue = undefined;
    vi.mocked(analytics.wizardCapture).mockClear();
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

  it('runs the declared tasks in order, with no planner', async () => {
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(ran).not.toContain('seed');
    expect(ran.indexOf('install')).toBeLessThan(ran.indexOf('logs'));
    expect(ran.indexOf('logs')).toBeLessThan(ran.indexOf('capture'));
    expect(ran[ran.length - 1]).toBe('report');
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

  it('runs a task the wizard queued first after the declared tasks, and the report after it', async () => {
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

  it('fails with its own code when the declared graph cannot be ordered', async () => {
    installWaitsFor = ['capture'];
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

  it('keeps the planner of a flow that has a planner prompt', async () => {
    withPlanner = true;
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(ran).toEqual(['seed', 'install', 'report']);
    expect(seeded()).toMatchObject({ source: 'planner' });
  });

  it('fails a flow with no planner prompt while the flag is off', async () => {
    agentDag = false;
    await expect(run()).rejects.toThrow(/No seed agent prompt/);
    expect(ran).toEqual([]);
  });
});
