import { detectProjectsWithAgent } from '../agentic';
import {
  AgentErrorType,
  initializeAgent,
  runAgent as executeAgent,
} from '@agent/agent-interface';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { ErrorCodes } from '@shared/errors';
import { getUI } from '@ui';
import { createUiReducer } from '@ui/agent-progress';

vi.mock('@utils/debug');
vi.mock('@ui', () => ({ getUI: () => ui }));
const ui = vi.hoisted(() => ({
  addTokenUsage: vi.fn(),
  setStage: vi.fn(),
  pushStatus: vi.fn(),
  showAuthError: vi.fn(),
  log: { error: vi.fn() },
}));
vi.mock('@agent/agent-interface', async (original) => ({
  ...(await original<typeof import('@agent/agent-interface')>()),
  initializeAgent: vi.fn(),
  runAgent: vi.fn(),
}));

function detectionSession() {
  const session = buildSession({ installDir: '/tmp/detection-test' });
  session.credentials = {
    accessToken: 'test',
    projectApiKey: 'phc_test',
    projectId: 1,
    host: HostResolution.fromApiHost('https://us.posthog.com'),
  };
  return session;
}

beforeEach(() => {
  vi.mocked(initializeAgent).mockReset();
  vi.mocked(executeAgent).mockReset();
});

it('keeps initialization and execution progress visible during detection', async () => {
  const delta = {
    inputTokens: 5,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  };
  vi.mocked(initializeAgent).mockImplementation((config) => {
    config.emit?.({
      kind: 'log',
      level: 'error',
      message: 'Initialization diagnostic',
    });
    return Promise.resolve({ emit: config.emit } as Awaited<
      ReturnType<typeof initializeAgent>
    >);
  });
  vi.mocked(executeAgent).mockImplementation(
    (config, _prompt, _options, _spinner, _messages, middleware) => {
      config.emit?.({ kind: 'usage', delta });
      config.emit?.({ kind: 'stage', stage: 'Scanning' });
      config.emit?.({ kind: 'status', message: 'Found a project' });
      config.emit?.({
        kind: 'log',
        level: 'error',
        message: 'Execution diagnostic',
      });
      middleware?.onMessage({
        type: 'result',
        result:
          '{"projects":[{"path":".","targetId":"node","framework":"Node.js"}]}',
      });
      return Promise.resolve({ kind: 'success' });
    },
  );
  const session = detectionSession();
  const inferenceAuth = { resolve: vi.fn() };
  session.inferenceAuth = inferenceAuth;
  const onProgress = vi.fn(createUiReducer(getUI()));
  const report = await detectProjectsWithAgent(session, {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
    onProgress,
  });
  expect(report.projects[0].targetId).toBe('node');
  expect(onProgress.mock.calls.map(([event]) => event.kind)).toEqual([
    'log',
    'usage',
    'stage',
    'status',
    'log',
  ]);
  expect(vi.mocked(initializeAgent).mock.calls[0][0].inferenceAuth).toBe(
    inferenceAuth,
  );
  expect(getUI().addTokenUsage).toHaveBeenCalledWith(delta);
  expect(ui.setStage).toHaveBeenCalledWith('Scanning');
  expect(ui.pushStatus).toHaveBeenCalledWith('Found a project');
  expect(ui.log.error.mock.calls).toEqual([
    ['Initialization diagnostic'],
    ['Execution diagnostic'],
  ]);
});

import { flushScanReport } from '@agent/yara-hooks';
import type { AgentProgress } from '@agent/types';

// Every test below goes through the real runAgent pipeline: no analytics
// client, no gateway mint and no scan-report write may leave the process.
vi.mock('@utils/analytics');
vi.mock('@programs/credentials', () => ({
  createPosthogInferenceAuthProvider: vi.fn(() => ({
    resolve: () =>
      Promise.resolve({
        gatewayUrl: 'https://gateway.test',
        token: 'phe_test',
        refreshAtMs: Infinity,
      }),
  })),
}));
vi.mock('@agent/yara-hooks', async (original) => ({
  ...(await original<typeof import('@agent/yara-hooks')>()),
  flushScanReport: vi.fn(),
}));

const cancelled = {
  kind: 'abort',
  classification: AgentErrorType.ABORT,
  message: 'Agent run cancelled',
} as const;

/** Each attempt's deadline, fired by the test instead of the clock. */
function fakeDeadlines(): AbortController[] {
  const deadlines: AbortController[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const deadline = new AbortController();
    deadlines.push(deadline);
    return deadline.signal;
  });
  return deadlines;
}

afterEach(() => vi.restoreAllMocks());

it('keeps both detection attempts on the host progress sink and the session provider', async () => {
  ui.setStage.mockClear();
  ui.pushStatus.mockClear();
  const deadlines = fakeDeadlines();
  vi.mocked(initializeAgent).mockImplementation((config) => {
    config.emit?.({ kind: 'status', message: 'Initializing' });
    return Promise.resolve({ emit: config.emit } as Awaited<
      ReturnType<typeof initializeAgent>
    >);
  });
  vi.mocked(executeAgent)
    .mockImplementationOnce((config) => {
      config.emit?.({ kind: 'stage', stage: 'First scan' });
      deadlines.at(-1)?.abort();
      return Promise.resolve(cancelled);
    })
    .mockImplementationOnce(
      (config, _prompt, _options, _spinner, _messages, middleware) => {
        config.emit?.({ kind: 'stage', stage: 'Second scan' });
        middleware?.onMessage({
          type: 'result',
          result:
            '{"projects":[{"path":".","targetId":"node","framework":"Node.js"}]}',
        });
        return Promise.resolve({ kind: 'success' });
      },
    );
  const session = detectionSession();
  const inferenceAuth = { resolve: vi.fn() };
  session.inferenceAuth = inferenceAuth;
  const onProgress = vi.fn();
  const onEvent = vi.fn();

  const report = await detectProjectsWithAgent(session, {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
    onProgress,
    onEvent,
  });

  expect(report.projects[0].targetId).toBe('node');
  expect(onEvent).toHaveBeenCalledWith('Project scan timed out; retrying...');
  const configs = vi
    .mocked(initializeAgent)
    .mock.calls.map(([config]) => config);
  expect(configs).toHaveLength(2);
  for (const config of configs) {
    expect(config.inferenceAuth).toBe(inferenceAuth);
  }
  expect(
    onProgress.mock.calls
      .map(([event]) => event as AgentProgress)
      .filter((event) => event.kind === 'status' || event.kind === 'stage'),
  ).toEqual([
    { kind: 'status', message: 'Initializing' },
    { kind: 'stage', stage: 'First scan' },
    { kind: 'status', message: 'Initializing' },
    { kind: 'stage', stage: 'Second scan' },
  ]);
  // The host owns the sink, so detection itself never reaches for the UI.
  expect(ui.setStage).not.toHaveBeenCalled();
  expect(ui.pushStatus).not.toHaveBeenCalled();
});

it.each([
  ['the session provider', true],
  ['a provider built from the credentials', false],
])('hands both detection attempts %s', async (_label, supplied) => {
  const deadlines = fakeDeadlines();
  vi.mocked(initializeAgent).mockResolvedValue(
    {} as Awaited<ReturnType<typeof initializeAgent>>,
  );
  vi.mocked(executeAgent)
    .mockImplementationOnce(() => {
      deadlines.at(-1)?.abort();
      return Promise.resolve(cancelled);
    })
    .mockImplementationOnce(
      (_config, _prompt, _options, _spinner, _messages, middleware) => {
        middleware?.onMessage({
          type: 'result',
          result:
            '{"projects":[{"path":".","targetId":"node","framework":"Node.js"}]}',
        });
        return Promise.resolve({ kind: 'success' });
      },
    );
  const session = detectionSession();
  const inferenceAuth = { resolve: vi.fn() };
  if (supplied) session.inferenceAuth = inferenceAuth;

  const report = await detectProjectsWithAgent(session, {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
  });

  expect(report.projects[0].targetId).toBe('node');
  const [first, second] = vi
    .mocked(initializeAgent)
    .mock.calls.map(([config]) => config.inferenceAuth);
  expect(vi.mocked(initializeAgent)).toHaveBeenCalledTimes(2);
  expect(first).toBeDefined();
  expect(second).toBe(first);
  if (supplied) expect(first).toBe(inferenceAuth);
  else expect(first).not.toBe(inferenceAuth);
});

it('sends each agent step to onEvent and the host only the progress it saw before', async () => {
  const delta = {
    inputTokens: 5,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  };
  vi.mocked(initializeAgent).mockImplementation((config) =>
    Promise.resolve({ emit: config.emit } as Awaited<
      ReturnType<typeof initializeAgent>
    >),
  );
  vi.mocked(executeAgent).mockImplementation(
    (config, _prompt, _options, _spinner, _messages, middleware) => {
      config.emit?.({ kind: 'usage', delta });
      config.emit?.({ kind: 'stage', stage: 'codebase-scan' });
      config.emit?.({
        kind: 'tasks',
        tasks: [{ content: 'Scan', status: 'in_progress' }],
      });
      config.emit?.({ kind: 'url', which: 'dashboard', url: 'https://d/1' });
      config.emit?.({ kind: 'status', message: 'Scanning' });
      config.emit?.({ kind: 'log', level: 'info', message: 'Info line' });
      config.emit?.({ kind: 'log', level: 'warn', message: 'Warn line' });
      config.emit?.({ kind: 'log', level: 'error', message: 'Error line' });
      middleware?.onMessage({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Reading the root manifest.' },
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'package.json' },
            },
          ],
        },
      });
      config.emit?.({ kind: 'finalCost', usd: 0.01 });
      middleware?.onMessage({
        type: 'result',
        result: '{"path":".","targetId":"node","framework":"Node.js"}',
      });
      return Promise.resolve({ kind: 'success' });
    },
  );
  const events: AgentProgress[] = [];
  const lines: string[] = [];

  const report = await detectProjectsWithAgent(detectionSession(), {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
    onEvent: (line) => lines.push(line),
    onProgress: (event) => events.push(event),
  });

  expect(report.projects[0].targetId).toBe('node');
  expect(lines).toEqual(['Reading the root manifest.', 'Read package.json']);
  expect(
    events.map((event) =>
      event.kind === 'log' ? `log:${event.level}` : event.kind,
    ),
  ).toEqual([
    'usage',
    'stage',
    'tasks',
    'url',
    'status',
    'log:warn',
    'log:error',
    'activity',
    'activity',
    'finalCost',
  ]);
  expect(ui.pushStatus).not.toHaveBeenCalledWith('Scanning');
});

it('leaves the scan report to the program run', async () => {
  vi.mocked(initializeAgent).mockResolvedValue(
    {} as Awaited<ReturnType<typeof initializeAgent>>,
  );
  vi.mocked(executeAgent).mockImplementation(
    (_config, _prompt, _options, _spinner, _messages, middleware) => {
      middleware?.onMessage({
        type: 'result',
        result: '{"path":".","targetId":"node","framework":"Node.js"}',
      });
      return Promise.resolve({ kind: 'success' });
    },
  );

  await detectProjectsWithAgent(
    { ...detectionSession(), yaraReport: true },
    {
      programId: 'posthog-integration',
      targets: [{ id: 'node', name: 'Node.js' }],
    },
  );

  expect(flushScanReport).not.toHaveBeenCalled();
});

it('stops optional detection on a data-only 401 before parsing partial JSON', async () => {
  vi.mocked(initializeAgent).mockResolvedValue(
    {} as Awaited<ReturnType<typeof initializeAgent>>,
  );
  vi.mocked(executeAgent).mockImplementation(
    (_config, _prompt, _options, _spinner, _messages, middleware) => {
      middleware?.onMessage({
        type: 'result',
        result: '{"projects":[{"path":".","targetId":"node"}]}',
      });
      return Promise.resolve({
        kind: 'decided_failure',
        failure: {
          code: ErrorCodes.AuthInvalidOrExpired,
          message: 'Authentication failed (401)',
        },
      });
    },
  );
  await expect(
    detectProjectsWithAgent(detectionSession(), {
      programId: 'posthog-integration',
      targets: [{ id: 'node', name: 'Node.js' }],
    }),
  ).rejects.toMatchObject({
    name: 'WizardError',
    code: ErrorCodes.AuthInvalidOrExpired,
    message: 'Authentication failed (401)',
  });
  expect(ui.showAuthError).not.toHaveBeenCalled();
});

it('preserves the original error from a decided failure', async () => {
  const original = new Error('Gateway bearer rejected');
  vi.mocked(initializeAgent).mockResolvedValue(
    {} as Awaited<ReturnType<typeof initializeAgent>>,
  );
  vi.mocked(executeAgent).mockResolvedValue({
    kind: 'decided_failure',
    failure: {
      code: ErrorCodes.GatewayMintRefused,
      message: original.message,
      error: original,
    },
  });

  await expect(
    detectProjectsWithAgent(detectionSession(), {
      programId: 'posthog-integration',
      targets: [{ id: 'node', name: 'Node.js' }],
    }),
  ).rejects.toBe(original);
});

it('rejects classified agent failures without retrying', async () => {
  vi.mocked(initializeAgent).mockResolvedValue(
    {} as Awaited<ReturnType<typeof initializeAgent>>,
  );
  vi.mocked(executeAgent).mockResolvedValue({
    kind: 'failure',
    classification: AgentErrorType.API_ERROR,
    message: 'Agent API unavailable',
  });

  await expect(
    detectProjectsWithAgent(detectionSession(), {
      programId: 'posthog-integration',
      targets: [{ id: 'node', name: 'Node.js' }],
    }),
  ).rejects.toThrow('Agent API unavailable');
  expect(vi.mocked(executeAgent)).toHaveBeenCalledOnce();
});
