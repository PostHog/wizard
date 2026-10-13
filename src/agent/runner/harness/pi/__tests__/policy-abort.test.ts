import { piBackend } from '..';
import { AgentErrorType } from '@agent/signals';
import { OperatorAbort } from '@agent/output-signals';
import { analytics } from '@utils/analytics';
import { Harness, Sequence, GPT5_6_LUNA_MODEL } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import type { BackendRunInputs, TaskRunInputs } from '../../types';

// The main and per-task pi sessions on a fake pi SDK; `events` is what each turn emits.

const PINNED_VERSION = 4;

const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  refreshedAuth: undefined as Record<string, unknown> | undefined,
  provider: {} as { apiKey?: string },
  bearers: [] as (string | undefined)[],
  tools: [] as { name: string; execute: (...args: never[]) => unknown }[],
  childReply: '',
  events: [] as unknown[],
  prompts: [] as string[],
  subscriber: undefined as ((event: never) => void) | undefined,
  abort: vi.fn(() => Promise.resolve()),
  rejectFirst: false,
  throwAfterEvents: false,
  openTasks: new Map(),
  onPrompt: undefined as (() => unknown) | undefined,
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
vi.mock('@earendil-works/pi-coding-agent', () => ({
  DefaultResourceLoader: class {
    reload() {
      return Promise.resolve();
    }
  },
  defineTool: (tool: unknown) => tool,
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
  createAgentSession: (options: { customTools: typeof state.tools }) => {
    // A session created mid-turn is the subagent's child; it answers with `childReply`.
    if (state.prompts.length > 0) {
      let child: (event: never) => void = () => undefined;
      return Promise.resolve({
        session: {
          subscribe: (handler: (event: never) => void) => {
            child = handler;
            return () => undefined;
          },
          prompt: () => {
            child({
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: state.childReply }],
                stopReason: 'stop',
              },
            } as never);
            return Promise.resolve();
          },
          abort: () => Promise.resolve(),
        },
      });
    }
    state.tools = options.customTools;
    return Promise.resolve({
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
          await state.onPrompt?.();
          state.bearers.push(state.provider.apiKey);
          if (state.rejectFirst && state.bearers.length === 1) {
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
    });
  },
}));

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
  state.refreshedAuth = undefined;
  state.bearers = [];
  state.tools = [];
  state.childReply = '';
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
      state.auth = { ...AUTH, promptPolicyVersion: PINNED_VERSION };
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
    state.auth = { ...AUTH, promptPolicyVersion: PINNED_VERSION };
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
    state.auth = { ...AUTH, promptPolicyVersion: PINNED_VERSION };
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
    state.auth = { ...AUTH, promptPolicyVersion: PINNED_VERSION };
    boot.operatorAbort = new OperatorAbort();
    boot.operatorAbort.trip('Triage refused.');
    expect(await run()).toMatchObject({
      kind: 'abort',
      message: 'Triage refused.',
    });
    expect(state.prompts).toHaveLength(0);
  });
});

it('ends the main run when a subagent reply carries the marker', async () => {
  state.auth = { ...AUTH, promptPolicyVersion: PINNED_VERSION };
  state.childReply = 'Found it.\n[posthog:abort] Off topic.';
  state.onPrompt = () =>
    state.tools
      .find((t) => t.name === 'dispatch_agent')
      ?.execute(
        ...([
          'id',
          { description: 'look', prompt: 'find it' },
        ] as unknown as never[]),
      );
  expect(await runMain()).toMatchObject({
    message: 'Off topic.',
    policy: true,
  });
  expect(state.abort).toHaveBeenCalledOnce();
});

describe.each([
  ['main', runMain],
  ['task', () => runTask()],
])('replacement credentials in %s', (_name, run) => {
  it('checks the replacement mint for the pinned version after an aged-token 401', async () => {
    state.auth = {
      ...AUTH,
      token: 'old-bearer',
      refreshAtMs: Date.now() - 1,
    };
    state.refreshedAuth = {
      ...AUTH,
      token: 'new-bearer',
      promptPolicyVersion: PINNED_VERSION,
      refreshAtMs: Date.now() + 60000,
    };
    state.rejectFirst = true;
    state.events.push(refusedTurn('[posthog:abort] Outside setup.'));
    expect(await run()).toMatchObject({
      kind: 'abort',
      message: 'Outside setup.',
      policy: true,
    });
    expect(state.bearers.slice(0, 2)).toEqual(['old-bearer', 'new-bearer']);
  });
});

describe.each([
  ['main', runMain],
  ['task', () => runTask()],
])('ordinary output in %s', (_name, run) => {
  it.each([
    [undefined, '[posthog:abort] Not an operator refusal without a pin.'],
    [PINNED_VERSION, '[posthog:aborted] reason'],
  ])(
    'keeps existing handling for %s / %s',
    async (promptPolicyVersion, text) => {
      state.auth = { ...AUTH, promptPolicyVersion };
      state.events.push(refusedTurn(text));
      expect((await run())?.kind).toBe('success');
      expect(state.abort).not.toHaveBeenCalled();
    },
  );
  it('preserves a refusal with no reason', async () => {
    state.auth = { ...AUTH, promptPolicyVersion: PINNED_VERSION };
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
