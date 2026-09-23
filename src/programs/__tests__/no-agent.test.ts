import {
  runNoAgentProgram,
  type NoAgentMcpPort,
  type NoAgentProgramInput,
} from '../no-agent';
import { ApiError } from '@shared/api';
import { ErrorCodes } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { fetchHealthIssues } from '@programs/posthog-doctor/fetch';
import { analytics } from '@utils/analytics';

vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('no-agent execution reached for UI');
  },
}));
vi.mock('@programs/posthog-doctor/fetch', () => ({
  fetchHealthIssues: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

const input = (): NoAgentProgramInput => ({
  installDir: '/tmp/no-agent-program',
  credentials: {
    accessToken: 'phx-test',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 23,
  },
});

const issue = (id: string, severity: 'critical' | 'warning' | 'info') => ({
  id,
  kind: 'sdk_missing',
  severity,
  status: 'active' as const,
  dismissed: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
});

const mcpPort = (): NoAgentMcpPort => ({
  detectSupportedClients: vi.fn().mockResolvedValue([]),
  add: vi.fn().mockResolvedValue([]),
  detectInstalledClients: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue([]),
});

beforeEach(() => vi.clearAllMocks());

it('returns a doctor report with active issues ordered for the headless caller', async () => {
  vi.mocked(fetchHealthIssues).mockResolvedValue([
    issue('info', 'info'),
    issue('critical', 'critical'),
    issue('warning', 'warning'),
  ]);

  const result = await runNoAgentProgram('posthog-doctor', input());

  expect(fetchHealthIssues).toHaveBeenCalledWith(
    'phx-test',
    'https://us.posthog.com',
    23,
  );
  expect(result).toEqual({
    outcome: 'success',
    data: {
      kind: 'doctor',
      issues: [
        issue('critical', 'critical'),
        issue('warning', 'warning'),
        issue('info', 'info'),
      ],
      hasIssues: true,
    },
  });
});

it('keeps a clean doctor report successful and maps an expired key to the existing code', async () => {
  vi.mocked(fetchHealthIssues).mockResolvedValueOnce([]);
  expect(await runNoAgentProgram('posthog-doctor', input())).toEqual({
    outcome: 'success',
    data: { kind: 'doctor', issues: [], hasIssues: false },
  });

  vi.mocked(fetchHealthIssues).mockRejectedValueOnce(
    new ApiError('Unauthorized', 401),
  );
  expect(await runNoAgentProgram('posthog-doctor', input())).toEqual({
    outcome: 'failed',
    failure: {
      code: ErrorCodes.AuthInvalidOrExpired,
      message: 'Your PostHog API key is invalid or expired.',
    },
  });
});

it('runs headless MCP add across clients and fails on any partial failure', async () => {
  const mcp = mcpPort();
  vi.mocked(mcp.detectSupportedClients).mockResolvedValue([
    'Cursor',
    'Codex',
    'Zed',
  ]);
  vi.mocked(mcp.add).mockResolvedValue([
    { name: 'Cursor', status: 'changed' },
    { name: 'Codex', status: 'unchanged' },
    { name: 'Zed', status: 'failed', detail: 'denied' },
  ]);

  const result = await runNoAgentProgram(
    'mcp-add',
    {
      ...input(),
      mcp: { local: true, features: ['feature-flags'], apiKey: 'phx-secret' },
    },
    { mcp },
  );

  expect(mcp.add).toHaveBeenCalledWith(['Cursor', 'Codex', 'Zed'], {
    local: true,
    features: ['feature-flags'],
    apiKey: 'phx-secret',
  });
  expect(result).toEqual({
    outcome: 'failed',
    data: {
      kind: 'mcp-add',
      installed: ['Cursor', 'Codex'],
      changed: ['Cursor'],
      alreadyInstalled: ['Codex'],
      failed: [{ name: 'Zed', status: 'failed', detail: 'denied' }],
      attempted: ['Cursor', 'Codex', 'Zed'],
    },
    failure: { message: 'Could not add the PostHog MCP server to Zed.' },
  });
  expect(analytics.wizardCapture).toHaveBeenCalledWith('mcp servers added', {
    clients: ['Cursor', 'Codex'],
    already_installed_clients: ['Codex'],
    failed_clients: ['Zed'],
    attempted_clients: ['Cursor', 'Codex', 'Zed'],
    integration: undefined,
  });
});

it('treats no supported MCP add client as a failed headless installation', async () => {
  const mcp = mcpPort();
  const result = await runNoAgentProgram('mcp-add', input(), { mcp });
  expect(mcp.add).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'failed',
    data: { kind: 'mcp-add', installed: [], failed: [], attempted: [] },
  });
});

it('does not start MCP installation after cancellation during detection', async () => {
  const mcp = mcpPort();
  const controller = new AbortController();
  let complete!: (clients: string[]) => void;
  vi.mocked(mcp.detectSupportedClients).mockImplementation(
    () =>
      new Promise<string[]>((resolve) => {
        complete = resolve;
      }),
  );

  const pending = runNoAgentProgram('mcp-add', input(), {
    mcp,
    signal: controller.signal,
  });
  controller.abort();
  complete(['Codex']);

  expect(await pending).toMatchObject({ outcome: 'aborted' });
  expect(mcp.add).not.toHaveBeenCalled();
});

it('reports per-client MCP remove failures while keeping the existing headless success outcome', async () => {
  const mcp = mcpPort();
  vi.mocked(mcp.detectInstalledClients).mockResolvedValue(['Codex', 'Zed']);
  vi.mocked(mcp.remove).mockResolvedValue([
    { name: 'Codex', status: 'changed' },
    { name: 'Zed', status: 'failed', detail: 'denied' },
  ]);

  expect(await runNoAgentProgram('mcp-remove', input(), { mcp })).toEqual({
    outcome: 'success',
    data: {
      kind: 'mcp-remove',
      removed: ['Codex'],
      unchanged: [],
      failed: [{ name: 'Zed', status: 'failed', detail: 'denied' }],
      attempted: ['Codex', 'Zed'],
    },
  });
});

it('runs headless MCP remove with local targeting and keeps empty removal successful', async () => {
  const mcp = mcpPort();
  vi.mocked(mcp.detectInstalledClients).mockResolvedValueOnce(['Codex']);
  vi.mocked(mcp.remove).mockResolvedValueOnce([
    { name: 'Codex', status: 'changed' },
  ]);

  const result = await runNoAgentProgram(
    'mcp-remove',
    { ...input(), mcp: { local: true } },
    { mcp },
  );

  expect(mcp.detectInstalledClients).toHaveBeenCalledWith(true);
  expect(mcp.remove).toHaveBeenCalledWith(['Codex'], true);
  expect(result).toEqual({
    outcome: 'success',
    data: {
      kind: 'mcp-remove',
      removed: ['Codex'],
      unchanged: [],
      failed: [],
      attempted: ['Codex'],
    },
  });

  vi.mocked(mcp.detectInstalledClients).mockResolvedValueOnce([]);
  expect(await runNoAgentProgram('mcp-remove', input(), { mcp })).toEqual({
    outcome: 'success',
    data: {
      kind: 'mcp-remove',
      removed: [],
      unchanged: [],
      failed: [],
      attempted: [],
    },
  });
});

it.each(['mcp-add', 'mcp-remove'] as const)(
  'reports a missing MCP capability for %s',
  async (programId) => {
    expect(await runNoAgentProgram(programId, input())).toEqual({
      outcome: 'failed',
      failure: {
        code: ErrorCodes.InternalUnhandled,
        message: `MCP capability is required to run ${programId}.`,
      },
    });
  },
);

it.each(['mcp-tutorial', 'slack'] as const)(
  'reports %s as interactive-required unless a workflow is supplied',
  async (programId) => {
    expect(await runNoAgentProgram(programId, input())).toEqual({
      outcome: 'interactive-required',
      failure: {
        code: ErrorCodes.CliInteractiveRequired,
        message: `${programId} requires an interactive workflow.`,
      },
    });
    const workflow = vi.fn().mockResolvedValue({
      outcome: 'success',
      data: { completed: true },
    });
    expect(await runNoAgentProgram(programId, input(), { workflow })).toEqual({
      outcome: 'success',
      data: { completed: true },
    });
    expect(workflow).toHaveBeenCalledWith({
      programId,
      installDir: '/tmp/no-agent-program',
      credentials: input().credentials,
    });
  },
);
