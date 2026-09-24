import { piBackend } from '..';
import type { TaskRunInputs } from '../../types';
import { HostResolution } from '@shared/host-resolution';
import { AgentErrorType } from '@agent/signals';

vi.mock('@utils/analytics');
vi.mock('@utils/debug');
vi.mock('@agent/yara-hooks', async (original) => ({
  ...(await original<typeof import('@agent/yara-hooks')>()),
  prewarmYaraScanner: vi.fn(),
}));
vi.mock('@agent/gateway-session', async (original) => ({
  ...(await original<typeof import('@agent/gateway-session')>()),
  gatewayAuth: () =>
    Promise.resolve({ gatewayUrl: 'https://gateway.test', token: 'phe_test' }),
}));
vi.mock('../mcp', () => ({
  fetchInstructions: vi.fn(),
  setupPostHogMcp: vi.fn().mockRejectedValue(new Error('offline')),
}));
vi.mock('../orchestrator-tools', () => ({
  createPiOrchestratorTools: () => [],
}));

let host: AbortController;
const session = vi.hoisted(() => {
  let finish!: () => void;
  return {
    bindExtensions: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    // The host cancels while the first turn is live.
    prompt: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          host.abort();
        }),
    ),
    abort: vi.fn(() => Promise.resolve(finish())),
  };
});
vi.mock('@earendil-works/pi-coding-agent', async (original) => ({
  ...(await original<typeof import('@earendil-works/pi-coding-agent')>()),
  createAgentSession: () => Promise.resolve({ session }),
  DefaultResourceLoader: class {
    reload = vi.fn();
  },
  AuthStorage: { create: vi.fn() },
  ModelRegistry: {
    inMemory: () => ({ registerProvider: vi.fn(), find: () => ({}) }),
  },
}));

afterEach(() => vi.clearAllMocks());

it.each(['run', 'runTask'] as const)(
  'aborts the live pi session when the host cancels %s',
  async (entry) => {
    host = new AbortController();
    const inputs = {
      config: { programId: 'metrics', run: {} },
      input: { installDir: '/tmp/pi-cancel-test', flags: {} },
      boot: {
        credentials: { host: HostResolution.fromRegion('us') },
        wizardMetadata: {},
        wizardFlags: {},
      },
      emit: vi.fn(),
      prompt: 'Do the work',
      spinner: { start: vi.fn(), stop: vi.fn(), message: vi.fn() },
      model: 'claude-test',
      signal: host.signal,
      orchestrator: { currentTaskId: 'task-1' },
    } as unknown as TaskRunInputs;
    const running =
      entry === 'run' ? piBackend.run(inputs) : piBackend.runTask?.(inputs);

    await expect(running).resolves.toEqual({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Agent run cancelled',
    });
    expect(session.abort).toHaveBeenCalledOnce();
  },
);
