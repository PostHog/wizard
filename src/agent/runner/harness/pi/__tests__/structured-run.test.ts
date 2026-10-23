import { piBackend } from '..';
import { runPiTask } from '../task';
import { AgentSignals, REMARK_INSTRUCTION } from '@agent/signals';
import { analytics } from '@utils/analytics';
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
  // The reply to the remark ask, when it differs from `text`.
  remark: undefined as string | undefined,
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
  toolName: 'find',
  toolError: undefined as string | undefined,
  toolResult: undefined as string | undefined,
  // A second turn in the same prompt: complete_task runs, then the agent replies.
  report: undefined as { settle: () => void; reply: string } | undefined,
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
  createGatewayRuntime: () =>
    Promise.resolve({
      registerProvider: () => undefined,
      getModel: () => ({ id: 'openai/gpt-5.6-luna', api: 'openai-responses' }),
    }),
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
  createWizardPiTools: () => [
    { name: 'set_env_values' },
    { name: 'load_skill_menu' },
  ],
}));
vi.mock('../tasks', () => ({
  createWizardPiTaskTools: () => ({ tools: [], store: state.tasks }),
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
  ModelRuntime: {
    create: () =>
      Promise.resolve({
        registerProvider: () => undefined,
        getModel: () => ({
          id: 'openai/gpt-5.6-luna',
          api: 'openai-responses',
        }),
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
              toolName: state.toolName,
              args: {},
            });
          if (state.toolError ?? state.toolResult)
            state.listener?.({
              type: 'tool_execution_end',
              toolName: state.toolName,
              isError: state.toolError !== undefined,
              result: {
                content: [
                  { type: 'text', text: state.toolError ?? state.toolResult },
                ],
              },
            });
          state.listener?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [
                ...state.preamble,
                (prompt === REMARK_INSTRUCTION && state.remark) || state.text,
              ].map((text) => ({
                type: 'text',
                text,
              })),
            },
          });
          if (state.report) {
            state.listener?.({
              type: 'tool_execution_start',
              toolName: 'complete_task',
              args: {},
            });
            state.report.settle();
            state.listener?.({
              type: 'tool_execution_end',
              toolName: 'complete_task',
              isError: false,
              result: { content: [{ type: 'text', text: 'ok' }] },
            });
            state.listener?.({
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: state.report.reply }],
              },
            });
          }
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
  const binding = {
    harness: Harness.pi,
    sequence: Sequence.linear,
    model: GPT5_6_LUNA_MODEL,
  };
  return {
    config: {
      programId: 'posthog-integration',
      composed: true,
      binding,
      switchboard: { program: 'posthog-integration', binding, flags: {} },
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
  state.toolName = 'find';
  state.toolError = undefined;
  state.toolResult = undefined;
  state.remark = undefined;
  state.report = undefined;
  vi.mocked(analytics.wizardCapture).mockClear();
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

it.each([
  ['dispatch_agent', 'abort'],
  ['read', 'success'],
])(
  'on a policy abort marker in a %s result, ends with %s',
  async (tool, kind) => {
    state.toolName = tool;
    state.toolResult = '[posthog:abort] Request is out of scope';
    state.text = 'Done.';
    // The turn ends only when the harness aborts the session.
    state.hang = kind === 'abort';

    const result = await piBackend.run(runInputs(vi.fn(), null));
    expect(result.kind).toBe(kind);
  },
);

it('ends a scan that outlives its budget as a timeout', async () => {
  state.hang = true;

  await expect(
    piBackend.run(runInputs(vi.fn(), { schema, timeoutMs: 1 })),
  ).resolves.toMatchObject({
    kind: 'failure',
    classification: AgentErrorType.AGENTIC_DETECTION_TIMEOUT,
  });
});

const runIn = (mode: 'linear' | 'task') => (inputs: BackendRunInputs) =>
  mode === 'linear'
    ? piBackend.run(inputs)
    : runPiTask({
        ...inputs,
        orchestrator: {
          currentTaskId: 'integration',
          validTypes: ['integration'],
          store: { get: () => ({ status: 'running' }) } as never,
        },
        spinnerMessage: 'Setting up SDK',
        successMessage: 'Installed the SDK',
        requestRemark: true,
        allowedTools: ['Read', 'load_skill_menu'],
        analyticsProperties: {},
      });

describe.each(['linear', 'task'] as const)('%s setup signals', (mode) => {
  const run = runIn(mode);

  it.each([
    [AgentSignals.ERROR_MCP_MISSING, AgentErrorType.MCP_MISSING],
    [AgentSignals.ERROR_RESOURCE_MISSING, AgentErrorType.RESOURCE_MISSING],
  ])(
    'fails unavailable setup instructions marked %s',
    async (marker, classification) => {
      state.toolName = 'load_skill_menu';
      state.toolError = 'Setup instructions could not be downloaded.';
      state.text = `${marker} Could not load setup instructions and halt.`;
      const inputs = runInputs(vi.fn(), null);
      inputs.config.run.successMessage = 'Installed the SDK';
      inputs.prompt = `Load the framework setup skill. If instructions are unavailable, emit ${marker} and halt.`;

      await expect(run(inputs)).resolves.toEqual({
        kind: 'failure',
        classification,
      });
      expect(state.prompts).toHaveLength(1);
      expect(analytics.wizardCapture).toHaveBeenCalledWith(
        'agent aborted',
        expect.objectContaining({ failure_mode: classification }),
      );
      expect(inputs.spinner.stop).not.toHaveBeenCalledWith('Installed the SDK');
      expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
        'agent completed',
        expect.anything(),
      );
    },
  );

  it('does not nudge unfinished work after a fatal setup signal', async () => {
    state.tasks.set('1', { status: 'in_progress' });
    state.text = `${AgentSignals.ERROR_MCP_MISSING} Setup unavailable.`;

    await expect(run(runInputs(vi.fn(), null))).resolves.toEqual({
      kind: 'failure',
      classification: AgentErrorType.MCP_MISSING,
    });
    expect(state.prompts).toHaveLength(1);
  });

  it('keeps security termination ahead of a fatal setup signal', async () => {
    state.text = `${AgentSignals.ERROR_RESOURCE_MISSING} Setup unavailable.`;
    vi.mocked(createSecurityExtension).mockReturnValueOnce({
      factory: () => undefined,
      state: { criticalViolation: true, blockedCount: 1 },
    } as unknown as ReturnType<typeof createSecurityExtension>);

    await expect(run(runInputs(vi.fn(), null))).resolves.toEqual({
      kind: 'failure',
      classification: AgentErrorType.YARA_VIOLATION,
    });
  });

  it('does not treat tool-result text as an agent-declared setup failure', async () => {
    state.toolError = `${AgentSignals.ERROR_RESOURCE_MISSING} Retry loading.`;
    state.text = 'Recovered and completed the setup.';

    await expect(run(runInputs(vi.fn(), null))).resolves.toEqual({
      kind: 'success',
    });
  });

  it('ends the run on a policy abort marker at the start of a reply, without a nudge', async () => {
    state.hang = true;
    state.tasks.set('1', { status: 'in_progress' });
    state.text = '[posthog:abort] Request is out of scope\nSorry.';

    await expect(run(runInputs(vi.fn(), null))).resolves.toEqual({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Request is out of scope',
    });
    expect(state.prompts).toHaveLength(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agent aborted',
      expect.objectContaining({
        failure_mode: AgentErrorType.ABORT,
        source: 'gateway_policy',
      }),
    );
  });

  it('ignores a policy abort marker in the remark reply', async () => {
    state.text = 'Installed the SDK.';
    state.remark = '[posthog:abort] Request is out of scope';

    await expect(run(runInputs(vi.fn(), null))).resolves.toEqual({
      kind: 'success',
    });
    expect(state.prompts).toContain(REMARK_INSTRUCTION);
  });

  it('keeps skill-install fallback nonfatal', async () => {
    state.text = `${AgentSignals.SKILL_INSTALL_FAILED} integration-test — unavailable; completed without the skill.`;

    await expect(run(runInputs(vi.fn(), null))).resolves.toEqual({
      kind: 'success',
    });
  });
});

describe.each(['linear', 'task'] as const)('%s skill abort marker', (mode) => {
  const run = runIn(mode);
  const abortingRun = () => {
    const inputs = runInputs(vi.fn(), null);
    inputs.config.run.successMessage = 'Installed the SDK';
    return inputs;
  };

  it('ends the run with the skill reason and no success', async () => {
    state.hang = true;
    state.tasks.set('1', { status: 'in_progress' });
    state.text =
      'Checked the project.\n[ABORT] Could not find a Stripe integration\nStopping.';
    const inputs = abortingRun();

    await expect(run(inputs)).resolves.toEqual({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Could not find a Stripe integration',
    });
    expect(state.prompts).toHaveLength(1);
    expect(inputs.spinner.stop).not.toHaveBeenCalledWith('Installed the SDK');
    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      'agent completed',
      expect.anything(),
    );
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agent aborted',
      expect.not.objectContaining({ source: 'gateway_policy' }),
    );
  });

  it('reads the marker from any block of the reply', async () => {
    state.hang = true;
    state.preamble = ['Checking the Stripe setup.'];
    state.text = '[ABORT] Could not find a Stripe integration';

    await expect(run(abortingRun())).resolves.toMatchObject({
      kind: 'abort',
      message: 'Could not find a Stripe integration',
    });
  });

  it('ignores the marker in the remark reply', async () => {
    state.text = 'Connected Stripe.';
    state.remark = '[WIZARD-REMARK] Say when to emit [ABORT] earlier';

    await expect(run(abortingRun())).resolves.toEqual({ kind: 'success' });
  });
});

describe('a task turn after complete_task', () => {
  const REFUSAL = '[posthog:abort] Request is out of scope';
  const runOrchestrated = (orchestrator: {
    currentTaskId?: string;
    store: unknown;
  }) =>
    runPiTask({
      ...runInputs(vi.fn(), null),
      orchestrator: { validTypes: ['integration'], ...orchestrator } as never,
      spinnerMessage: 'Setting up SDK',
      successMessage: 'Installed the SDK',
      requestRemark: false,
      allowedTools: ['Read'],
      analyticsProperties: {},
    });

  it.each([
    ['a policy', REFUSAL],
    ['a skill', '[ABORT] Could not find a Stripe integration'],
  ])(
    'ignores %s abort marker in the closing reply once the task has reported',
    async (_label, reply) => {
      const task = { status: 'running' };
      state.text = 'Installed the SDK.';
      state.report = { settle: () => (task.status = 'done'), reply };

      await expect(
        runOrchestrated({
          currentTaskId: 'integration',
          store: { get: () => task },
        }),
      ).resolves.toEqual({ kind: 'success' });
      expect(state.prompts).toHaveLength(1);
      expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
        'agent aborted',
        expect.anything(),
      );
    },
  );

  it('still ends a seeded orchestrator run on a policy abort marker', async () => {
    state.text = REFUSAL;

    await expect(
      runOrchestrated({ store: { list: () => [{ id: '1' }] } }),
    ).resolves.toMatchObject({ kind: 'abort' });
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
