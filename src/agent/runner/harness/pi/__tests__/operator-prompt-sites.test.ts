import { piBackend } from '..';
import { Harness, Sequence, GPT5_6_LUNA_MODEL } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import type { BackendRunInputs, TaskRunInputs } from '../../types';
import type {
  ExtensionAPI,
  ExtensionFactory,
} from '@earendil-works/pi-coding-agent';

// The main run and a per-task run each build a pi session. Every model call that
// session makes goes through the extensions it registered, so the test runs a
// real-shaped request through those extensions, in order, as pi does.

const PINNED = 'PINNED OPERATOR PROMPT\n';
const WIZARD_OWN = 'WIZARD OWN PROMPT';

const state = vi.hoisted(() => ({
  factories: [] as ExtensionFactory[],
  systemPrompt: undefined as string | undefined,
  auth: {} as Record<string, unknown>,
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), capture: vi.fn() },
}));
vi.mock('@utils/debug');
vi.mock('@agent/yara-hooks', () => ({ prewarmYaraScanner: vi.fn() }));
vi.mock('@agent/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/gateway-session')>()),
  gatewayAuth: vi.fn(() => Promise.resolve(state.auth)),
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
  createWizardPiTaskTools: () => ({ tools: [], store: new Map() }),
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
      registerProvider: () => undefined,
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
        subscribe: () => () => undefined,
        prompt: () => Promise.resolve(),
        getSessionStats: () => ({
          tokens: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
        }),
        abort: () => Promise.resolve(),
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

const runTask = () =>
  piBackend.runTask?.({
    config,
    input,
    boot,
    emit: vi.fn(),
    prompt: 'go',
    model: GPT5_6_LUNA_MODEL,
    spinner,
    orchestrator: { store: { list: () => [{}], get: () => undefined } },
    spinnerMessage: '',
    successMessage: '',
    requestRemark: false,
    analyticsProperties: {},
  } as unknown as TaskRunInputs);

beforeEach(() => {
  state.factories = [];
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
