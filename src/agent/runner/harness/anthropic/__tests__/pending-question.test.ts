import { initializeAgent, wizardCanUseTool } from '@agent/agent-interface';
import { createAskBridge } from '../../../shared/ask';
import { anthropicBackend } from '..';
import type { BackendRunInputs, TaskRunInputs } from '../../types';
import type { AskAnswers } from '@lib/wizard-session';
import { Harness, Sequence } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';

vi.mock('@utils/analytics');
vi.mock('@utils/debug');
vi.mock('@agent/aio-capture', () => ({ createAioCapture: vi.fn() }));
vi.mock('@agent/agent-interface', async (original) => ({
  ...(await original<typeof import('@agent/agent-interface')>()),
  initializeAgent: vi.fn().mockResolvedValue({}),
  runAgent: vi.fn().mockResolvedValue({}),
}));

const questions = [{ id: 'q', prompt: 'Continue?', kind: 'text' as const }];

async function initializeHarness(
  mode: 'linear' | 'task',
  askBridge: BackendRunInputs['askBridge'],
) {
  const credentials = {
    accessToken: 'test',
    projectApiKey: 'test',
    projectId: 1,
    host: HostResolution.fromApiHost('https://us.posthog.com'),
  };
  const inputs: BackendRunInputs = {
    config: {
      programId: 'test',
      run: {
        integrationLabel: 'test',
        spinnerMessage: 'Working',
        successMessage: 'Done',
        estimatedDurationMinutes: 1,
        reportFile: 'report.md',
        docsUrl: 'https://docs.test',
      },
      composed: false,
      binding: {
        harness: Harness.anthropic,
        sequence: Sequence.linear,
        model: 'test',
      },
      switchboard: { program: 'test', flags: {} },
      skillsBaseUrl: 'https://skills.test',
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
    },
    input: {
      installDir: '/test',
      flags: {
        ci: false,
        signup: false,
        debug: false,
        e2eAsk: false,
        localMcp: false,
        captureAio: false,
        benchmark: false,
        yaraReport: false,
      },
      host: {},
      credentials,
      project: null,
      apiUser: null,
    },
    boot: {
      programId: 'test',
      skillsBaseUrl: 'https://skills.test',
      credentials,
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
      project: null,
      triageProvider: undefined,
    },
    emit: vi.fn(),
    prompt: 'test',
    spinner: { start: vi.fn(), stop: vi.fn(), message: vi.fn() },
    model: 'test',
    askBridge,
  };
  if (mode === 'linear') {
    await anthropicBackend.run(inputs);
  } else {
    if (!anthropicBackend.runTask) throw new Error('Missing task harness');
    await anthropicBackend.runTask({
      ...inputs,
      spinnerMessage: 'Working',
      successMessage: 'Done',
      requestRemark: false,
      analyticsProperties: {},
      orchestrator: {} as TaskRunInputs['orchestrator'],
    });
  }
  const call = vi.mocked(initializeAgent).mock.calls.at(-1);
  if (!call) throw new Error('Harness did not initialize the agent');
  const [config] = call;
  return (behavior: 'allow' | 'deny') => {
    for (const tool of ['Write', 'Edit']) {
      expect(
        wizardCanUseTool(
          tool,
          { file_path: 'src/app.ts', content: 'changed' },
          { wizardAskPending: config.getPendingQuestion?.() != null },
        ).behavior,
      ).toBe(behavior);
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe.each(['linear', 'task'] as const)(
  'Anthropic %s pending-question permission guard',
  (mode) => {
    it.each(['answer', 'cancel', 'timeout', 'reject'] as const)(
      'blocks simultaneous Write/Edit and releases them after %s',
      async (ending) => {
        vi.useFakeTimers();
        let resolve!: (answers: AskAnswers) => void;
        let reject!: (error: Error) => void;
        let signal: AbortSignal | undefined;
        const bridge = createAskBridge(
          {
            ask: (_question, context) => {
              expectPermission('deny');
              signal = context.signal;
              return new Promise((res, rej) => {
                resolve = res;
                reject = rej;
              });
            },
          },
          { getSource: () => 'test', richLinks: false, timeoutMs: 1000 },
        );
        if (!bridge) throw new Error('Missing ask bridge');
        const expectPermission = await initializeHarness(mode, bridge);
        expectPermission('allow');
        const pending = bridge.request({ questions });
        expectPermission('deny');

        if (ending === 'reject') {
          const rejected = expect(pending).rejects.toThrow('answerer failed');
          reject(new Error('answerer failed'));
          await rejected;
        } else {
          if (ending === 'timeout') {
            await vi.advanceTimersByTimeAsync(1000);
          } else {
            resolve({ q: ending === 'answer' ? 'yes' : '__cancelled__' });
          }
          await expect(pending).resolves.toEqual({
            answers: { q: ending === 'answer' ? 'yes' : '__cancelled__' },
            timedOut: ending === 'timeout',
          });
        }

        expectPermission('allow');
        expect(signal?.aborted).toBe(ending === 'timeout');
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it('keeps the guard when a concurrent question is rejected', async () => {
      let resolve!: (answers: AskAnswers) => void;
      const ask = vi
        .fn()
        .mockImplementationOnce(
          () => new Promise<AskAnswers>((res) => (resolve = res)),
        )
        .mockRejectedValueOnce(new Error('another request is pending'));
      const bridge = createAskBridge(
        { ask },
        { getSource: () => 'test', richLinks: false },
      );
      if (!bridge) throw new Error('Missing ask bridge');
      const expectPermission = await initializeHarness(mode, bridge);
      const first = bridge.request({ questions });
      await expect(bridge.request({ questions })).rejects.toThrow(
        'another request is pending',
      );
      expectPermission('deny');
      resolve({ q: 'yes' });
      await first;
      expectPermission('allow');
    });

    it('allows file mutations without an answerer', async () => {
      const expectPermission = await initializeHarness(mode, undefined);
      expectPermission('allow');
    });
  },
);
