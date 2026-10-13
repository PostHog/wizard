import { piBackend } from '..';
import { AgentErrorType } from '@agent/signals';
import { OperatorAbort } from '@agent/output-signals';
import { analytics } from '@utils/analytics';
import { Harness, Sequence, GPT5_6_LUNA_MODEL } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import type { BackendRunInputs, TaskRunInputs } from '../../types';
import type {
  ExtensionAPI,
  ExtensionFactory,
} from '@earendil-works/pi-coding-agent';

// Runs a real-shaped request through each pi session's registered extensions, in order, as pi does.

const PINNED = 'PINNED OPERATOR PROMPT\n';
const WIZARD_OWN = 'WIZARD OWN PROMPT';

const state = vi.hoisted(() => ({
  factories: [] as ExtensionFactory[],
  systemPrompt: undefined as string | undefined,
  auth: {} as Record<string, unknown>,
  refreshedAuth: undefined as Record<string, unknown> | undefined,
  provider: {} as { apiKey?: string },
  requests: [] as { bearer: string | undefined; payload: unknown }[],
  events: [] as unknown[],
  prompts: [] as string[],
  subscriber: undefined as ((event: never) => void) | undefined,
  abort: vi.fn(() => Promise.resolve()),
  rejectFirst: false,
  throwAfterEvents: false,
  openTasks: new Map(),
  onPrompt: undefined as (() => void) | undefined,
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), capture: vi.fn() },
}));
vi.mock('@utils/debug');
vi.mock('@agent/yara-hooks', () => ({ prewarmYaraScanner: vi.fn() }));
vi.mock('@agent/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/gateway-session')>()),
  gatewayAuth: vi.fn(() => {
    const auth = state.auth;
    if (state.refreshedAuth) {
      state.auth = state.refreshedAuth;
      state.refreshedAuth = undefined;
    }
    return Promise.resolve(auth);
  }),
}));
vi.mock('../security', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../security')>()),
  createSecurityExtension: () => ({
    factory: () => undefined,
    subagentFactory: () => undefined,
    state: { criticalViolation: false },
  }),
}));
vi.mock('../mcp', () => ({
  fetchInstructions: () => Promise.resolve(undefined),
  setupPostHogMcp: () =>
    Promise.resolve({ extensionFactory: () => undefined, cleanup: vi.fn() }),
}));
vi.mock('../tools', () => ({ createWizardPiTools: () => [] }));
vi.mock('../tasks', () => ({
  createWizardPiTaskTools: () => ({ tools: [], store: state.openTasks }),
}));
vi.mock('../orchestrator-tools', () => ({
  createPiOrchestratorTools: () => [],
}));
vi.mock('../subagent', () => ({
  createDispatchAgentTool: () => ({ name: 'dispatch_agent' }),
}));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  DefaultResourceLoader: class {
    constructor(options: { extensionFactories: ExtensionFactory[] }) {
      state.factories = options.extensionFactories;
    }
    reload() {
      return Promise.resolve();
    }
  },
  AuthStorage: { create: () => ({}) },
  ModelRegistry: {
    inMemory: () => ({
      registerProvider: (_name: string, provider: { apiKey: string }) => {
        state.provider = provider;
      },
      find: () => ({ id: GPT5_6_LUNA_MODEL, api: 'openai-responses' }),
    }),
  },
  SessionManager: { inMemory: () => ({}) },
  getAgentDir: () => '/tmp/test-agent',
  ...Object.fromEntries(
    ['Ls', 'Find', 'Grep', 'Bash', 'Read', 'Edit', 'Write'].map((name) => [
      `create${name}ToolDefinition`,
      () => ({ name: name.toLowerCase() }),
    ]),
  ),
  createAgentSession: () =>
    Promise.resolve({
      session: {
        bindExtensions: () => Promise.resolve(),
        subscribe: (handler: (event: never) => void) => {
          state.subscriber = handler;
          return () => {
            state.subscriber = undefined;
          };
        },
        prompt: async (text: string) => {
          state.prompts.push(text);
          state.onPrompt?.();
          state.requests.push({
            bearer: state.provider.apiKey,
            payload: await sentRequest(),
          });
          if (state.rejectFirst && state.requests.length === 1) {
            state.subscriber?.({
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [],
                stopReason: 'error',
                errorMessage: '401 Unauthorized',
              },
            } as never);
            return;
          }
          for (const event of state.events) state.subscriber?.(event as never);
          if (state.throwAfterEvents) throw new Error('Session aborted');
        },
        getSessionStats: () => ({
          tokens: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
        }),
        abort: state.abort,
      },
    }),
}));

/** The request pi builds for a Responses call: the wizard's prompt leads `input`. */
const piRequest = () => ({
  model: GPT5_6_LUNA_MODEL,
  input: [
    { role: 'system', content: WIZARD_OWN },
    { role: 'user', content: [{ type: 'input_text', text: 'go' }] },
  ],
});

/** Run the request through the session's registered extensions, as pi does. */
async function sentRequest(): Promise<{ input: { content: unknown }[] }> {
  // The session was built, so its extensions were handed to the loader.
  expect(state.factories.length).toBeGreaterThan(0);
  const handlers: ((event: { payload: unknown }) => unknown)[] = [];
  for (const factory of state.factories) {
    await factory({
      on: (
        event: string,
        handler: (event: { payload: unknown }) => unknown,
      ) => {
        if (event === 'before_provider_request') handlers.push(handler);
      },
    } as unknown as ExtensionAPI);
  }
  let payload: unknown = piRequest();
  for (const handler of handlers) {
    payload = (await handler({ payload })) ?? payload;
  }
  return payload as { input: { content: unknown }[] };
}

const credentials = {
  accessToken: 'test',
  projectApiKey: 'test',
  projectId: 1,
  host: HostResolution.fromApiHost('https://us.posthog.com'),
};
const boot = {
  credentials,
  programId: 'posthog-integration',
  skillsBaseUrl: '',
  wizardFlags: {},
  wizardFlagPayloads: {},
  wizardMetadata: {},
  project: null,
  triageProvider: undefined,
  operatorAbort: undefined as OperatorAbort | undefined,
};
const binding = {
  harness: Harness.pi,
  sequence: Sequence.linear,
  model: GPT5_6_LUNA_MODEL,
};
const config = {
  programId: 'posthog-integration',
  composed: true,
  binding,
  switchboard: { program: 'posthog-integration', binding, flags: {} },
  skillsBaseUrl: '',
  wizardFlags: {},
  wizardFlagPayloads: {},
  wizardMetadata: {},
  run: {
    integrationLabel: 'x',
    spinnerMessage: '',
    successMessage: '',
    reportFile: '',
    docsUrl: '',
    estimatedDurationMinutes: 1,
  },
};
const input = {
  installDir: '/tmp/test-run',
  credentials,
  project: null,
  apiUser: null,
  flags: {
    ci: true,
    signup: false,
    debug: false,
    captureAio: false,
    benchmark: false,
    yaraReport: false,
    localMcp: false,
    e2eAsk: false,
  },
  host: {},
};
const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };

const runMain = () =>
  piBackend.run({
    config,
    input,
    boot,
    emit: vi.fn(),
    prompt: 'go',
    model: GPT5_6_LUNA_MODEL,
    spinner,
    middleware: { onMessage: vi.fn(), finalize: vi.fn() },
  } as unknown as BackendRunInputs);

const runTask = (unsettled = false) =>
  piBackend.runTask?.({
    config,
    input,
    boot,
    emit: vi.fn(),
    prompt: 'go',
    model: GPT5_6_LUNA_MODEL,
    spinner,
    orchestrator: {
      currentTaskId: unsettled ? 'task-1' : undefined,
      store: { list: () => [{}], get: () => undefined },
    },
    spinnerMessage: '',
    successMessage: '',
    requestRemark: true,
    analyticsProperties: {},
  } as unknown as TaskRunInputs);

beforeEach(() => {
  state.factories = [];
  state.refreshedAuth = undefined;
  state.requests = [];
  state.prompts = [];
  state.events = [{ type: 'tool_execution_start', toolName: 'read', args: {} }];
  state.rejectFirst = false;
  state.throwAfterEvents = false;
  state.openTasks = new Map();
  state.onPrompt = undefined;
  boot.operatorAbort = undefined;
  vi.clearAllMocks();
});

const AUTH = { gatewayUrl: 'https://gateway.test', token: 'test' };

describe.each([
  ['the main run', runMain],
  ['a task run', runTask],
])('%s', (_name, run) => {
  it('sends the pinned operator prompt first, the wizard prompt a separate unit after it', async () => {
    state.auth = { ...AUTH, systemPrompt: PINNED, systemPromptVersion: 4 };

    await run();

    const { input: units } = await sentRequest();
    expect(units.map((u) => u.content).slice(0, 2)).toEqual([
      PINNED,
      WIZARD_OWN,
    ]);
  });

  it('sends the request unchanged when the mint pinned nothing', async () => {
    state.auth = AUTH;

    await run();

    expect(await sentRequest()).toEqual(piRequest());
  });
});

const refusedTurn = (text: string) => ({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  },
});

describe.each([
  ['main', runMain],
  ['seed', () => runTask()],
  ['task', () => runTask(true)],
])('operator refusal in %s', (_name, run) => {
  it.each([false, true])(
    'returns the refusal without continuation, remarks or completion (SDK throws: %s)',
    async (throws) => {
      state.throwAfterEvents = throws;
      state.auth = { ...AUTH, systemPrompt: PINNED };
      state.openTasks.set('1', {
        id: '1',
        status: 'in_progress',
        subject: 'Set up SDK',
      });
      state.events.push(
        refusedTurn('[posthog:abort] This request is outside setup.'),
      );
      const result = await run();
      expect(result).toEqual({
        kind: 'abort',
        classification: AgentErrorType.ABORT,
        message: 'This request is outside setup.',
        policy: true,
      });
      expect(state.prompts).toHaveLength(1);
      expect(state.abort).toHaveBeenCalledOnce();
      expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
        'agent completed',
        expect.anything(),
      );
    },
  );

  it('ends the run on a marker in the middle of a reply', async () => {
    state.auth = { ...AUTH, systemPrompt: PINNED };
    state.events.push(
      refusedTurn(
        'Step one is done.\n[posthog:abort] Outside setup scope.\nMore text.',
      ),
    );
    expect(await run()).toEqual({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Outside setup scope.',
      policy: true,
    });
    expect(state.prompts).toHaveLength(1);
    expect(state.abort).toHaveBeenCalledOnce();
  });

  it('ends the run when the YARA triage model refuses mid-run', async () => {
    state.auth = { ...AUTH, systemPrompt: PINNED };
    boot.operatorAbort = new OperatorAbort();
    state.onPrompt = () => boot.operatorAbort?.trip('Triage refused.');
    expect(await run()).toEqual({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Triage refused.',
      policy: true,
    });
    expect(state.abort).toHaveBeenCalledOnce();
  });

  it('sends no turn when triage refused before the session started', async () => {
    state.auth = { ...AUTH, systemPrompt: PINNED };
    boot.operatorAbort = new OperatorAbort();
    boot.operatorAbort.trip('Triage refused.');
    expect(await run()).toMatchObject({
      kind: 'abort',
      message: 'Triage refused.',
    });
    expect(state.prompts).toHaveLength(0);
  });
});

describe.each([
  ['main', runMain],
  ['task', () => runTask()],
])('replacement credentials in %s', (_name, run) => {
  it('uses the replacement bearer and its prompt after an aged-token 401', async () => {
    state.auth = {
      ...AUTH,
      token: 'old-bearer',
      systemPrompt: 'OLD PROMPT',
      refreshAtMs: Date.now() - 1,
    };
    state.refreshedAuth = {
      ...AUTH,
      token: 'new-bearer',
      systemPrompt: 'NEW PROMPT',
      refreshAtMs: Date.now() + 60000,
    };
    state.rejectFirst = true;
    await run();
    expect(state.requests.slice(0, 2)).toEqual([
      {
        bearer: 'old-bearer',
        payload: expect.objectContaining({
          input: expect.arrayContaining([
            { role: 'system', content: 'OLD PROMPT' },
          ]),
        }),
      },
      {
        bearer: 'new-bearer',
        payload: expect.objectContaining({
          input: expect.arrayContaining([
            { role: 'system', content: 'NEW PROMPT' },
          ]),
        }),
      },
    ]);
  });
});

describe.each([
  ['main', runMain],
  ['task', () => runTask()],
])('ordinary output in %s', (_name, run) => {
  it.each([
    [undefined, '[posthog:abort] Not an operator refusal without a pin.'],
    [PINNED, '[posthog:aborted] reason'],
  ])('keeps existing handling for %s / %s', async (systemPrompt, text) => {
    state.auth = { ...AUTH, systemPrompt };
    state.events.push(refusedTurn(text));
    expect((await run())?.kind).toBe('success');
    expect(state.abort).not.toHaveBeenCalled();
  });
  it('preserves a refusal with no reason', async () => {
    state.auth = { ...AUTH, systemPrompt: PINNED };
    state.events.push(refusedTurn(' \n[posthog:abort]'));
    expect(await run()).toEqual({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'The operator policy refused this request.',
      policy: true,
    });
    expect(state.prompts).toHaveLength(1);
  });
});
