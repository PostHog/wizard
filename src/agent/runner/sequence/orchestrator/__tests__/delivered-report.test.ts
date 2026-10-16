/**
 * The run report is the run's deliverable. Once the sink task has published it,
 * a failure of that task (its own, or a harness throw that ends the run) must
 * not turn the run into a failure, while any other task's failure still does.
 */
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
    areSeededTasksEnabled: () => false,
    isSkillResolverEnabled: () => false,
    areBundledPromptsEnabled: () => false,
    isTypedGraphEnabled: () => false,
    getHarness: () => ({ runTask: (inputs: unknown) => harnessRun(inputs) }),
  };
});
vi.mock('../../../../agent-prompt-loader', async (importActual) => {
  const actual = await importActual<
    typeof import('../../../../agent-prompt-loader')
  >();
  const prompt = (type: string, over: object = {}) => ({
    type,
    flow: 'test-flow',
    seed: false,
    sink: false,
    runnerSeeded: false,
    optional: false,
    skills: [],
    allowedTools: [],
    disallowedTools: [],
    dependsOn: [],
    body: type,
    ...over,
  });
  return {
    ...actual,
    loadAgentRegistry: () =>
      Promise.resolve(
        actual.buildRegistry(
          [
            prompt('plan', { seed: true }),
            prompt('install'),
            prompt('report', { sink: true }),
          ],
          'test-flow',
        ),
      ),
  };
});

import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';

type Inputs = {
  emit: (event: { kind: 'handoff'; text: string }) => void;
  signal: AbortSignal;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

type Behavior = (inputs: Inputs, taskId: string) => void;
let behaviors: Record<string, Behavior>;

/** The fake harness: the seed queues install then report, each task runs its scripted behavior. */
function harnessRun(raw: unknown) {
  const inputs = raw as Inputs;
  const { store } = inputs.orchestrator;
  const type = inputs.analyticsProperties.task_type;
  if (type === 'seed') {
    const install = store.enqueue({ type: 'install', maxAttempts: 1 });
    store.enqueue({
      type: 'report',
      dependsOn: [install.id],
      maxAttempts: 1,
    });
  } else {
    behaviors[type](inputs, inputs.analyticsProperties.task_id as string);
  }
  return Promise.resolve({ kind: 'success' as const });
}

const publish = (inputs: Inputs) =>
  inputs.emit({ kind: 'handoff', text: '# Report' });

describe('a task failing after the run report was published', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delivered-report-'));
    behaviors = {
      install: (inputs, id) => inputs.orchestrator.store.complete(id),
    };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (signal?: AbortSignal) =>
    runOrchestrator({
      config: {
        programId: 'test-flow',
        wizardFlags: {},
        wizardFlagPayloads: {},
        switchboard: {},
      },
      input: { installDir: dir, flags: { ci: true } },
      boot: {
        skillsBaseUrl: 'https://skills.test',
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
      signal,
    } as unknown as SequenceContext);

  it('keeps the run successful when the sink ends Failed', async () => {
    behaviors.report = (inputs, id) => {
      publish(inputs);
      inputs.orchestrator.store.fail(id, { type: 'boom', message: 'x' });
    };

    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(result.outro?.message).toBe(
      'PostHog set up: 1/2 steps completed (report delivered, then its step failed).',
    );
  });

  it('keeps the run successful when the sink publishes, then its harness throws', async () => {
    behaviors.report = (inputs) => {
      publish(inputs);
      throw new Error('gateway error');
    };

    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(result.outro?.message).toContain('report delivered');
  });

  it('still fails the run when a task other than the sink published then failed', async () => {
    behaviors.install = (inputs, id) => {
      publish(inputs);
      inputs.orchestrator.store.fail(id, { type: 'boom', message: 'x' });
    };

    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Failed);
  });

  it('reports cancelled when the host cancels after the sink fatal fired, before the drain ends', async () => {
    const host = new AbortController();
    behaviors.report = (inputs) => {
      publish(inputs);
      // Fires inside the drain's own abort, once the fatal is already captured.
      inputs.signal.addEventListener('abort', () => host.abort(), {
        once: true,
      });
      throw new Error('gateway error');
    };

    const result = await run(host.signal);

    expect(result.outcome).toBe(RunOutcome.Aborted);
  });
});
