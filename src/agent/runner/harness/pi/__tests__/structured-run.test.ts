import { piBackend } from '..';
import { createSecurityExtension } from '../security';
import { setupPostHogMcp } from '../mcp';
import {
  Harness,
  Sequence,
  GPT5_6_LUNA_MODEL,
  WIZARD_USER_AGENT,
} from '@shared/constants';
import { AgentErrorType } from '@agent/agent-interface';
import { HostResolution } from '@shared/host-resolution';
import type { BackendRunInputs } from '../../types';
import type {
  ExtensionAPI,
  ExtensionFactory,
} from '@earendil-works/pi-coding-agent';

const state = vi.hoisted(() => ({
  listener: undefined as ((event: unknown) => void) | undefined,
  factories: [] as ExtensionFactory[],
  text: '',
  prompts: [] as string[],
  request: undefined as unknown,
  tools: [] as { name: string }[],
  tasks: new Map<string, { status: string }>(),
  // A hung turn ends only when the harness aborts the session.
  hang: false,
  release: undefined as (() => void) | undefined,
  // The turn answers without calling a tool.
  noTools: false,
  // Commentary blocks sent before the answer in the same turn.
  preamble: [] as string[],
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), capture: vi.fn() },
}));
vi.mock('@utils/debug');
vi.mock('@agent/yara-hooks', () => ({ prewarmYaraScanner: vi.fn() }));
vi.mock('@agent/gateway-session', () => ({
  gatewayAuth: vi
    .fn()
    .mockResolvedValue({ gatewayUrl: 'https://gateway.test', token: 'test' }),
}));
vi.mock('../gateway', () => ({
  GATEWAY_PROVIDER: 'test',
  buildGatewayProvider: () => ({
    provider: {},
    caps: { thinkingLevel: 'low' },
    api: 'openai-responses',
  }),
  withGatewayRemint: ({
    session,
  }: {
    session: { prompt: (text: string) => Promise<void> };
  }) => ({
    prompt: session.prompt,
    noteAssistantTurn: vi.fn(),
    terminalFailure: () => undefined,
  }),
}));
vi.mock('../security', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../security')>()),
  createSecurityExtension: vi.fn(() => ({
    factory: () => undefined,
    state: { criticalViolation: false },
  })),
}));
vi.mock('../mcp', () => ({
  fetchInstructions: () => Promise.resolve(undefined),
  setupPostHogMcp: vi.fn(() =>
    Promise.resolve({
      extensionFactory: () => undefined,
      cleanup: () => undefined,
    }),
  ),
}));
vi.mock('../tools', () => ({
  createWizardPiTools: () => [{ name: 'set_env_values' }],
}));
vi.mock('../tasks', () => ({
  createWizardPiTaskTools: () => ({ tools: [], store: state.tasks }),
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
      registerProvider: () => undefined,
      find: () => ({ id: 'openai/gpt-5.6-luna', api: 'openai-responses' }),
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
  createAgentSession: (options: { customTools: { name: string }[] }) => {
    state.tools = options.customTools;
    return Promise.resolve({
      session: {
        bindExtensions: async () => {
          for (const factory of state.factories) {
            await factory({
              on: (
                event: string,
                handler: (event: { payload: unknown }) => unknown,
              ) => {
                if (event === 'before_provider_request')
                  state.request = handler({
                    payload: { model: GPT5_6_LUNA_MODEL, tools: [] },
                  });
              },
            } as ExtensionAPI);
          }
        },
        subscribe: (listener: typeof state.listener) => {
          state.listener = listener;
          return () => undefined;
        },
        prompt: (prompt: string) => {
          state.prompts.push(prompt);
          if (!state.noTools)
            state.listener?.({
              type: 'tool_execution_start',
              toolName: 'find',
              args: {},
            });
          state.listener?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [...state.preamble, state.text].map((text) => ({
                type: 'text',
                text,
              })),
            },
          });
          return state.hang
            ? new Promise<void>((resolve) => (state.release = resolve))
            : Promise.resolve();
        },
        getSessionStats: () => ({
          tokens: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
        }),
        abort: () => {
          state.release?.();
          return Promise.resolve();
        },
      },
    });
  },
}));

const schema = {
  type: 'object',
  properties: { projects: { type: 'array' } },
};

function runInputs(
  onMessage: (message: unknown) => void,
  structured: BackendRunInputs['structured'] | null = {
    schema,
    timeoutMs: 60_000,
  },
): BackendRunInputs {
  const credentials = {
    accessToken: 'test',
    projectApiKey: 'test',
    projectId: 1,
    host: HostResolution.fromApiHost('https://us.posthog.com'),
  };
  return {
    config: {
      programId: 'posthog-integration',
      composed: true,
      binding: {
        harness: Harness.pi,
        sequence: Sequence.linear,
        model: GPT5_6_LUNA_MODEL,
      },
      switchboard: { program: 'posthog-integration', flags: {} },
      skillsBaseUrl: '',
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
      run: {
        integrationLabel: 'agentic-detect',
        spinnerMessage: '',
        successMessage: '',
        reportFile: '',
        docsUrl: '',
        estimatedDurationMinutes: 1,
      },
    },
    input: {
      installDir: '/tmp/test-detect',
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
    },
    boot: {
      credentials,
      programId: 'posthog-integration',
      skillsBaseUrl: '',
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
      project: null,
      triageProvider: undefined,
    },
    emit: vi.fn(),
    prompt: 'Scan the repo',
    model: GPT5_6_LUNA_MODEL,
    spinner: { start: vi.fn(), stop: vi.fn(), message: vi.fn() },
    middleware: { onMessage, finalize: vi.fn() },
    structured: structured ?? undefined,
  };
}

beforeEach(() => {
  state.prompts = [];
  state.tasks.clear();
  state.hang = false;
  state.noTools = false;
  state.preamble = [];
});

it.each([
  [
    'typed report',
    '{"repoType":"single","projects":[]}',
    { repoType: 'single', projects: [] },
  ],
  ['malformed report', 'I found a project.', undefined],
])(
  'returns the %s with no remark or task nudges',
  async (_label, text, expected) => {
    state.text = text;
    state.tasks.set('1', { status: 'in_progress' });
    const onMessage = vi.fn();

    await expect(piBackend.run(runInputs(onMessage))).resolves.toEqual({
      kind: 'success',
      structuredOutput: expected,
    });
    expect(state.request).toMatchObject({
      text: { format: { type: 'json_schema', strict: true, schema } },
    });
    expect(state.prompts).toEqual(['Scan the repo']);
    expect(onMessage).toHaveBeenCalledWith({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'find', input: {} }] },
    });
    // Transcript recovery reads the assistant text the harness feeds here.
    expect(onMessage).toHaveBeenCalledWith({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    });
  },
);

it('returns the last block when a turn sends commentary before its answer', async () => {
  const answer = '{"repoType":"single","projects":[]}';
  state.preamble = ['{"repoType":"monorepo","projects":[]}'];
  state.text = answer;
  const onMessage = vi.fn();

  await expect(piBackend.run(runInputs(onMessage))).resolves.toEqual({
    kind: 'success',
    structuredOutput: { repoType: 'single', projects: [] },
  });
  expect(onMessage).toHaveBeenCalledWith({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '{"repoType":"monorepo","projects":[]}' },
        { type: 'text', text: answer },
      ],
    },
  });
});

it('reports a scan that answers without reading the repo as invalid output', async () => {
  state.noTools = true;
  state.text = '{"repoType":"single","projects":[]}';

  await expect(piBackend.run(runInputs(vi.fn()))).resolves.toMatchObject({
    kind: 'failure',
    classification: AgentErrorType.INVALID_STRUCTURED_OUTPUT,
  });
});

it('ends a scan with a latched security violation as YARA, even past its budget', async () => {
  state.hang = true;
  vi.mocked(createSecurityExtension).mockReturnValueOnce({
    factory: () => undefined,
    state: { criticalViolation: true, blockedCount: 1 },
  } as unknown as ReturnType<typeof createSecurityExtension>);

  await expect(
    piBackend.run(runInputs(vi.fn(), { schema, timeoutMs: 1 })),
  ).resolves.toMatchObject({
    kind: 'failure',
    classification: AgentErrorType.YARA_VIOLATION,
  });
});

it('ends a scan that outlives its budget as a timeout', async () => {
  state.hang = true;

  await expect(
    piBackend.run(runInputs(vi.fn(), { schema, timeoutMs: 1 })),
  ).resolves.toMatchObject({
    kind: 'failure',
    classification: AgentErrorType.AGENTIC_DETECTION_TIMEOUT,
  });
});

it('keeps the remark and leaves the middleware alone on an integration run', async () => {
  state.text = 'Installed the SDK.';
  const onMessage = vi.fn();

  await piBackend.run(runInputs(onMessage, null));
  expect(state.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      'edit',
      'write',
      'bash',
      'set_env_values',
      'dispatch_agent',
    ]),
  );
  expect(state.prompts).toHaveLength(2);
  expect(onMessage).not.toHaveBeenCalled();
});

it.each(['self-driving-setup', 'agentic-detect', 'metrics'])(
  'tags the MCP user-agent with `program: %s`',
  async (integrationLabel) => {
    // The backend reads this marker to attribute what the run creates — without it a
    // self-driving run's warehouse sources record as generic wizard work.
    const inputs = runInputs(vi.fn());
    inputs.config.run.integrationLabel = integrationLabel;
    vi.mocked(setupPostHogMcp).mockClear();

    await piBackend.run(inputs);

    expect(setupPostHogMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: `${WIZARD_USER_AGENT}; program: ${integrationLabel}`,
      }),
    );
  },
);

it('registers only filesystem readers for a read-only scan and fences tool calls', async () => {
  const inputs = runInputs(vi.fn());
  inputs.config.run.readOnly = true;
  vi.mocked(setupPostHogMcp).mockClear();

  await piBackend.run(inputs);

  expect(state.tools.map((tool) => tool.name).sort()).toEqual([
    'find',
    'grep',
    'ls',
    'read',
  ]);
  expect(setupPostHogMcp).not.toHaveBeenCalled();
  expect(createSecurityExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({ readOnly: true }),
  );
});
