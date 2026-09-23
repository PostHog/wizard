import { piBackend } from '..';
import type { BackendRunInputs, TaskRunInputs } from '../../types';
import { Harness, Sequence } from '@shared/config/constants';
import { HostResolution } from '@shared/posthog/host-resolution';
import { AgentErrorType } from '@agent/progress/signals';

vi.mock('@utils/analytics');
vi.mock('@utils/debug');
vi.mock('@agent/security/yara-hooks', () => ({ prewarmYaraScanner: vi.fn() }));
vi.mock('@agent/sdk/aio-capture', () => ({
  createAioCapture: () => ({
    captureFromPiMessageEndEvent: vi.fn(),
    setInitialPrompt: vi.fn(),
    finishPiRun: vi.fn(),
  }),
}));
vi.mock('../security', () => ({
  createSecurityExtension: () => ({
    factory: vi.fn(),
    state: { criticalViolation: false, blockedCount: 0 },
  }),
}));
vi.mock('../mcp', () => ({
  fetchInstructions: vi.fn().mockResolvedValue(undefined),
  setupPostHogMcp: vi.fn().mockRejectedValue(new Error('offline fixture')),
}));
vi.mock('../tools', () => ({ createWizardPiTools: () => [] }));
vi.mock('../tasks', () => ({
  createWizardPiTaskTools: () => ({ tools: [], store: new Map() }),
}));
vi.mock('../subagent', () => ({
  createDispatchAgentTool: () => ({ name: 'dispatch_agent' }),
}));
vi.mock('../orchestrator-tools', () => ({
  createPiOrchestratorTools: () => [],
}));

let agentSession: {
  bindExtensions: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};
const createAgentSession = vi.hoisted(() => vi.fn());
vi.mock('@earendil-works/pi-coding-agent', () => {
  const tool = (name: string) => () => ({ name });
  return {
    createAgentSession,
    DefaultResourceLoader: class {
      reload = vi.fn().mockResolvedValue(undefined);
    },
    SessionManager: { inMemory: vi.fn().mockReturnValue({}) },
    AuthStorage: { create: vi.fn().mockReturnValue({}) },
    ModelRegistry: {
      inMemory: () => ({
        registerProvider: vi.fn(),
        find: vi.fn().mockReturnValue({ id: 'claude-test' }),
      }),
    },
    getAgentDir: () => '/tmp/pi-agent',
    createLsToolDefinition: tool('ls'),
    createFindToolDefinition: tool('find'),
    createGrepToolDefinition: tool('grep'),
    createBashToolDefinition: tool('bash'),
    createReadToolDefinition: tool('read'),
    createEditToolDefinition: tool('edit'),
    createWriteToolDefinition: tool('write'),
  };
});

function inputs(signal: AbortSignal): BackendRunInputs {
  const credentials = {
    accessToken: 'phx_test',
    projectApiKey: 'phc_test',
    projectId: 42,
    host: HostResolution.fromRegion('us'),
  };
  const inferenceAuth = {
    resolve: () =>
      Promise.resolve({
        gatewayUrl: 'https://ai-gateway.us.posthog.com',
        token: 'fixed-test-bearer',
        teamId: 42,
        refreshAtMs: Infinity,
      }),
  };
  return {
    config: {
      programId: 'metrics',
      run: {
        integrationLabel: 'metrics',
        spinnerMessage: 'Working',
        successMessage: 'Done',
        estimatedDurationMinutes: 1,
        reportFile: 'report.md',
        docsUrl: 'https://docs.test',
      },
      composed: false,
      binding: {
        harness: Harness.pi,
        sequence: Sequence.linear,
        model: 'claude-test',
      },
      programCommandments: [],
      skillsBaseUrl: 'https://skills.test',
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
    },
    input: {
      installDir: '/tmp/pi-cancel-test',
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
      inferenceAuth,
      project: null,
      apiUser: null,
    },
    boot: {
      programId: 'metrics',
      skillsBaseUrl: 'https://skills.test',
      credentials,
      inferenceAuth,
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
      project: null,
      triageProvider: undefined,
    },
    emit: vi.fn(),
    prompt: 'Do the work',
    spinner: { start: vi.fn(), stop: vi.fn(), message: vi.fn() },
    model: 'claude-test',
    signal,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  let finishPrompt!: () => void;
  agentSession = {
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    prompt: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPrompt = resolve;
        }),
    ),
    abort: vi.fn(() => {
      finishPrompt();
      return Promise.resolve();
    }),
  };
  createAgentSession.mockResolvedValue({ session: agentSession });
});

it.each(['linear', 'task'] as const)(
  'forwards live host cancellation to the pi %s session',
  async (mode) => {
    const controller = new AbortController();
    const base = inputs(controller.signal);
    if (!piBackend.runTask) throw new Error('Missing pi task backend');
    const pending =
      mode === 'linear'
        ? piBackend.run(base)
        : piBackend.runTask({
            ...base,
            config: {
              ...base.config,
              binding: {
                ...base.config.binding,
                sequence: Sequence.orchestrator,
              },
            },
            orchestrator: {
              currentTaskId: 'task-1',
            } as TaskRunInputs['orchestrator'],
            allowedTools: [],
            disallowedTools: [],
            spinnerMessage: 'Working',
            successMessage: 'Done',
            errorMessage: 'Failed',
            additionalFeatureQueue: [],
            requestRemark: false,
            analyticsProperties: {},
          });

    await vi.waitFor(() => expect(agentSession.prompt).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).resolves.toEqual({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Agent run cancelled',
    });
    expect(agentSession.abort).toHaveBeenCalledOnce();
  },
);
