import { piBackend } from '..';
import { Harness, Sequence, GPT5_6_LUNA_MODEL } from '@shared/constants';
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
vi.mock('../security', () => ({
  createSecurityExtension: () => ({
    factory: () => undefined,
    state: { criticalViolation: false },
  }),
}));
vi.mock('../mcp', () => ({
  fetchInstructions: () => Promise.resolve(undefined),
  setupPostHogMcp: () =>
    Promise.resolve({
      extensionFactory: () => undefined,
      cleanup: () => undefined,
    }),
}));
vi.mock('../tools', () => ({ createWizardPiTools: () => [] }));
vi.mock('../tasks', () => ({
  createWizardPiTaskTools: () => ({ tools: [], store: new Map() }),
}));
vi.mock('../subagent', () => ({ createDispatchAgentTool: () => ({}) }));
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
      () => ({ name }),
    ]),
  ),
  createAgentSession: () =>
    Promise.resolve({
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
          state.listener?.({
            type: 'tool_execution_start',
            toolName: 'find',
            args: {},
          });
          state.listener?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: state.text }],
            },
          });
          return Promise.resolve();
        },
        getSessionStats: () => ({
          tokens: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
        }),
        abort: () => Promise.resolve(),
      },
    }),
}));

it.each([
  [
    'typed report',
    '{"repoType":"single","projects":[]}',
    { repoType: 'single', projects: [] },
  ],
  ['malformed report', 'I found a project.', undefined],
])(
  'delivers the %s from Pi without overwriting it with a remark',
  async (_label, text, expected) => {
    state.text = text;
    state.prompts = [];
    const onMessage = vi.fn();
    const credentials = {
      accessToken: 'test',
      projectApiKey: 'test',
      projectId: 1,
      host: HostResolution.fromApiHost('https://us.posthog.com'),
    };
    const outputFormat = {
      type: 'json_schema' as const,
      schema: { type: 'object', properties: { projects: { type: 'array' } } },
    };
    const inputs: BackendRunInputs = {
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
          outputFormat,
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
    };
    await expect(piBackend.run(inputs)).resolves.toEqual({ kind: 'success' });
    expect(state.request).toMatchObject({
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          schema: outputFormat.schema,
        },
      },
    });
    expect(state.prompts).toEqual(['Scan the repo']);
    expect(onMessage).toHaveBeenLastCalledWith({
      type: 'result',
      subtype: 'success',
      result: text,
      structured_output: expected,
    });
  },
);
