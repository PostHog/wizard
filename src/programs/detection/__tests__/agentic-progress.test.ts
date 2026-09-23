import { detectProjectsWithAgent } from '../agentic';
import {
  AgentErrorType,
  initializeAgent,
  runAgent as executeAgent,
} from '@agent/agent-interface';
import { HostResolution } from '@shared/host-resolution';
import { createUiReducer } from '@programs';
import { buildSession } from '@tui/session';
import { getUI } from '@cli/ui';
import { ErrorCodes } from '@shared/errors';

vi.mock('@utils/debug');
vi.mock('@cli/ui', () => ({ getUI: () => ui }));
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

it('rejects classified agent failures', async () => {
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
});
