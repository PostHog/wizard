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
    isAgentDagEnabled: () => false,
    isAgentDagSkillsEnabled: () => false,
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
            prompt('install', {
              timeoutMs: taskTimeoutMs,
              onTimeout: taskOnTimeout,
            }),
            prompt('review', {
              timeoutMs: taskTimeoutMs,
              onTimeout: taskOnTimeout,
            }),
            prompt('report', { sink: true }),
          ],
          'test-flow',
        ),
      ),
  };
});

import { createBashToolDefinition } from '@earendil-works/pi-coding-agent';
import { analytics } from '@utils/analytics';
import { AgentErrorType } from '../../../../agent-interface';
import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';

type Inputs = {
  onBashCommand?: (command: string | undefined) => void;
  emit: (event: { kind: 'handoff'; text: string }) => void;
  signal: AbortSignal;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

type Behavior = (inputs: Inputs, taskId: string) => void | Promise<void>;
let behaviors: Record<string, Behavior>;
let taskTimeoutMs: number | undefined;
let taskOnTimeout: 'continue' | 'fail' | undefined;
let maxAttempts = 1;
let installOptional = false;
let installResult: unknown;
let firstTaskType = 'install';

/** The fake harness: the seed queues install then report, each task runs its scripted behavior. */
async function harnessRun(raw: unknown) {
  const inputs = raw as Inputs;
  const { store } = inputs.orchestrator;
  const type = inputs.analyticsProperties.task_type;
  if (type === 'seed') {
    const install = store.enqueue({
      type: firstTaskType,
      maxAttempts,
      optional: installOptional,
    });
    store.enqueue({
      type: 'report',
      dependsOn: [install.id],
      maxAttempts: 1,
    });
  } else {
    await behaviors[type](inputs, inputs.analyticsProperties.task_id as string);
    if (type === 'install' && installResult) return installResult;
  }
  return Promise.resolve({ kind: 'success' as const });
}

const publish = (inputs: Inputs) =>
  inputs.emit({ kind: 'handoff', text: '# Report' });

describe('a task failing after the run report was published', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delivered-report-'));
    taskTimeoutMs = undefined;
    taskOnTimeout = undefined;
    maxAttempts = 1;
    installOptional = false;
    installResult = undefined;
    firstTaskType = 'install';
    behaviors = {
      install: (inputs, id) => {
        inputs.orchestrator.store.complete(id);
      },
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

  it('joins timed-out work, reports an incomplete task, and neither retries nor starts dependents', async () => {
    taskTimeoutMs = 10;
    taskOnTimeout = 'fail';
    maxAttempts = 3;
    let cleaned = false;
    let queue: QueueStore | undefined;
    let calls = 0;
    behaviors.install = async (inputs) => {
      calls++;
      inputs.onBashCommand?.('pnpm typecheck');
      queue = inputs.orchestrator.store;
      await new Promise<void>((resolve) =>
        inputs.signal.addEventListener('abort', () => resolve(), {
          once: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      inputs.onBashCommand?.(undefined);
      cleaned = true;
    };
    behaviors.report = vi.fn();
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.message).toContain('Task incomplete');
    expect(result.failure?.message).toContain('will not be retried');
    expect(result.failure?.message).toContain(
      'Interrupted command: pnpm typecheck',
    );
    expect(cleaned).toBe(true);
    expect(calls).toBe(1);
    expect(behaviors.report).not.toHaveBeenCalled();
    expect(queue?.list().find((task) => task.type === 'install')).toMatchObject(
      { status: 'failed', attempts: 1, error: { type: 'timeout' } },
    );
  });

  const untilAborted = (inputs: Inputs) =>
    new Promise<void>((resolve) =>
      inputs.signal.addEventListener('abort', () => resolve(), { once: true }),
    );

  it('completes a task with onTimeout continue, so its dependents run and the report says what is unverified', async () => {
    taskTimeoutMs = 10;
    taskOnTimeout = 'continue';
    maxAttempts = 3;
    let calls = 0;
    let queue: QueueStore | undefined;
    let forReport: string | undefined;
    behaviors.install = async (inputs) => {
      calls++;
      queue = inputs.orchestrator.store;
      inputs.onBashCommand?.('pnpm typecheck');
      await untilAborted(inputs);
    };
    behaviors.report = (inputs, id) => {
      const { store } = inputs.orchestrator;
      const install = store.list().find((task) => task.type === 'install');
      forReport = store.readHandoff(install?.id ?? '')?.forNextAgent;
      publish(inputs);
      store.complete(id);
    };
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(calls).toBe(1);
    expect(queue?.list().find((task) => task.type === 'install')).toMatchObject(
      { status: 'done', attempts: 1 },
    );
    expect(forReport).toContain('did not finish');
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'orchestrator task deadline exceeded',
      expect.objectContaining({
        type: 'install',
        landing: 'continued',
        interrupted_command: true,
      }),
    );
  });

  it('tells the user a timed-out review left its checks unverified', async () => {
    taskTimeoutMs = 10;
    taskOnTimeout = 'continue';
    firstTaskType = 'review';
    behaviors.review = async (inputs) => {
      inputs.onBashCommand?.('pnpm typecheck');
      await untilAborted(inputs);
    };
    behaviors.report = (inputs, id) => {
      publish(inputs);
      inputs.orchestrator.store.complete(id);
    };
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(result.outro?.message).toBe(
      'PostHog set up, but its final checks did not finish.',
    );
    expect(result.outro?.body).toContain('Verification incomplete');
    expect(result.outro?.body).toContain('its edits may be partial');
    expect(result.outro?.body).toContain('Interrupted command: pnpm typecheck');
    expect(result.outro?.body).not.toContain('Build conflict');
  });

  it('takes a real hanging command through the deadline to the outro', async () => {
    taskTimeoutMs = 500;
    taskOnTimeout = 'continue';
    firstTaskType = 'review';
    const bash = createBashToolDefinition(dir);
    const script = `require("node:fs").writeFileSync("child.pid", String(process.pid)); setTimeout(() => require("node:fs").writeFileSync("survived", "yes"), 1000); setInterval(() => {}, 1000);`;
    const hang = `"${process.execPath}" -e '${script}' & wait`;
    behaviors.review = async (inputs) => {
      inputs.onBashCommand?.('pnpm build');
      await bash
        .execute(
          'hang',
          { command: hang, timeout: 300 },
          inputs.signal,
          undefined,
          undefined as never,
        )
        .catch(() => undefined);
      inputs.onBashCommand?.(undefined);
    };
    behaviors.report = (inputs, id) => {
      publish(inputs);
      inputs.orchestrator.store.complete(id);
    };
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(result.outro?.body).toContain('Verification incomplete');
    expect(result.outro?.body).toContain('Interrupted command: pnpm build');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(fs.existsSync(path.join(dir, 'child.pid'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'survived'))).toBe(false);
  });

  it('keeps the build conflict label for a conflict the review reported itself', async () => {
    firstTaskType = 'review';
    behaviors.review = (inputs, id) => {
      inputs.orchestrator.store.complete(id, {
        goals: 'g',
        did: 'd',
        forNextAgent: 'n',
        conflict: 'pre-existing build error',
      });
    };
    behaviors.report = (inputs, id) => {
      publish(inputs);
      inputs.orchestrator.store.complete(id);
    };
    const result = await run();
    expect(result.outro?.message).toBe(
      'PostHog set up, with one conflict to review.',
    );
    expect(result.outro?.body).toContain(
      'Build conflict: pre-existing build error',
    );
  });

  it('keeps a task that reported done before its deadline done', async () => {
    taskTimeoutMs = 10;
    taskOnTimeout = 'continue';
    let queue: QueueStore | undefined;
    behaviors.install = async (inputs, id) => {
      queue = inputs.orchestrator.store;
      queue.complete(id);
      await untilAborted(inputs);
    };
    behaviors.report = (inputs, id) => {
      publish(inputs);
      inputs.orchestrator.store.complete(id);
    };
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(queue?.list().find((task) => task.type === 'install')).toMatchObject(
      { status: 'done', attempts: 1 },
    );
    expect(queue?.list().find((task) => task.type === 'report')?.status).toBe(
      'done',
    );
  });

  it('fails a timed-out optional task once and carries on to its dependents', async () => {
    taskTimeoutMs = 10;
    taskOnTimeout = 'continue';
    maxAttempts = 3;
    installOptional = true;
    let calls = 0;
    let queue: QueueStore | undefined;
    behaviors.install = async (inputs) => {
      calls++;
      queue = inputs.orchestrator.store;
      await untilAborted(inputs);
    };
    behaviors.report = (inputs, id) => {
      publish(inputs);
      inputs.orchestrator.store.complete(id);
    };
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(calls).toBe(1);
    expect(queue?.list().find((task) => task.type === 'install')).toMatchObject(
      { status: 'failed', attempts: 1, error: { type: 'timeout' } },
    );
    expect(queue?.list().find((task) => task.type === 'report')?.status).toBe(
      'done',
    );
  });

  it('keeps a security stop fatal when the deadline passes as it lands', async () => {
    taskTimeoutMs = 10;
    taskOnTimeout = 'continue';
    installResult = {
      kind: 'failure',
      classification: AgentErrorType.YARA_VIOLATION,
    };
    behaviors.install = async (inputs) => {
      await untilAborted(inputs);
    };
    behaviors.report = vi.fn();
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.message).not.toContain('Task incomplete');
    expect(behaviors.report).not.toHaveBeenCalled();
  });

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
