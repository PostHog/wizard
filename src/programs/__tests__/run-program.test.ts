import { runAgent, RunOutcome } from '@agent';
import { Harness, Sequence } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import type { FrameworkConfig } from '../framework-config';
import { getProgramConfig } from '../program-registry';
import { runProgram } from '@programs';

vi.mock('@agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent')>()),
  runAgent: vi.fn(),
  DEFAULT_AGENT_BINDING: {
    sequence: 'linear',
    harness: 'anthropic',
    model: 'claude-test',
  },
  RunOutcome: {
    Success: 'success',
    Aborted: 'aborted',
    Failed: 'failed',
    Crashed: 'crashed',
  },
}));
vi.mock('../program-registry', () => ({
  getProgramConfig: vi.fn(),
}));

const run = {
  integrationLabel: 'metrics',
  spinnerMessage: 'Configuring metrics',
  successMessage: 'Metrics configured',
  estimatedDurationMinutes: 5,
  reportFile: 'posthog-metrics-report.md',
  docsUrl: 'https://posthog.com/docs/metrics',
};

const snapshot = {
  tasks: [],
  statusMessages: ['Metrics configured'],
  usage: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
};

const credentials = {
  posthog: {
    accessToken: 'phx_access_test',
    projectApiKey: 'phx_test',
    projectId: 42,
    host: HostResolution.fromRegion('us'),
  },
  inferenceAuth: { resolve: vi.fn() },
  project: null,
  apiUser: null,
};

describe('runProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProgramConfig).mockReturnValue({
      id: 'metrics',
      description: 'Add application metrics',
      steps: [],
      run,
    });
  });

  it('calls a static program with explicit inputs and returns attributed progress and final results', async () => {
    const observed: unknown[] = [];
    vi.mocked(runAgent).mockImplementation((_config, _input, options) => {
      options?.onProgress?.({ kind: 'status', message: 'Metrics configured' });
      return Promise.resolve({
        outcome: RunOutcome.Success,
        skillId: 'metrics',
        snapshot,
      });
    });

    const outcome = await runProgram(
      'metrics',
      {
        installDir: '/project',
        runId: 'run-1',
        binding: {
          sequence: Sequence.linear,
          harness: Harness.anthropic,
          model: 'claude-test',
        },
        credentials,
      },
      { onProgress: (event) => observed.push(event) },
    );

    expect(runAgent).toHaveBeenCalledTimes(1);
    const [config, input] = vi.mocked(runAgent).mock.calls[0];
    expect(config.programId).toBe('metrics');
    expect(config.run).toBe(run);
    expect(input.installDir).toBe('/project');
    expect(input.credentials.projectId).toBe(42);
    expect(input.inferenceAuth).toBe(credentials.inferenceAuth);
    expect(observed).toEqual([
      {
        runId: 'run-1',
        event: { kind: 'status', message: 'Metrics configured' },
      },
    ]);
    expect(outcome).toMatchObject({
      programId: 'metrics',
      outcome: 'success',
      runResults: [{ outcome: 'success', skillId: 'metrics' }],
      data: {
        runs: [
          {
            runId: 'run-1',
            phase: 'finished',
            outcome: 'success',
            snapshot: { statusMessages: ['Metrics configured'] },
          },
        ],
      },
      artifacts: { reportFile: '/project/posthog-metrics-report.md' },
    });
  });

  it('returns a decided failure for an unknown program before invoking the agent', async () => {
    vi.mocked(getProgramConfig).mockReturnValueOnce(undefined as never);

    const outcome = await runProgram('missing-program', {
      installDir: '/project',
      credentials,
    });

    expect(outcome).toMatchObject({
      outcome: 'failed',
      failure: { message: 'Unknown program: missing-program' },
      runResults: [],
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('resolves a dynamic program from explicit input without a TUI session', async () => {
    vi.mocked(getProgramConfig).mockReturnValueOnce({
      id: 'events-audit',
      description: 'Audit events',
      steps: [],
      run: vi.fn(),
    });
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      skillId: 'events-audit',
      snapshot,
    });

    const result = await runProgram('events-audit', {
      installDir: '/project',
      credentials,
      typescript: true,
    });

    expect(result.outcome).toBe('success');
    expect(vi.mocked(runAgent).mock.calls[0][0].run.reportFile).toBe(
      'posthog-events-audit-report.md',
    );
    expect(vi.mocked(runAgent).mock.calls[0][0].run.customPrompt).toBeTypeOf(
      'function',
    );
    expect(result.artifacts.reportFile).toBe(
      '/project/posthog-events-audit-report.md',
    );
  });

  it('runs a no-agent program through a host capability without credentials', async () => {
    vi.mocked(getProgramConfig).mockReturnValueOnce({
      id: 'mcp-add',
      description: 'Add MCP',
      steps: [],
      requiresAi: false,
    });
    const mcp = {
      detectSupportedClients: vi.fn().mockResolvedValue(['Claude']),
      add: vi.fn().mockResolvedValue([{ name: 'Claude', status: 'changed' }]),
      detectInstalledClients: vi.fn(),
      remove: vi.fn(),
    };

    const result = await runProgram(
      'mcp-add',
      { installDir: '/project' },
      { mcp },
    );

    expect(result).toMatchObject({
      programId: 'mcp-add',
      outcome: 'success',
      programData: { kind: 'mcp-add', installed: ['Claude'] },
      runResults: [],
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('resolves credentials once through the caller provider', async () => {
    const resolve = vi.fn().mockResolvedValue(credentials);
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });

    const result = await runProgram(
      'metrics',
      {
        installDir: '/project',
        binding: {
          sequence: Sequence.linear,
          harness: Harness.anthropic,
          model: 'claude-test',
        },
      },
      { credentials: { resolve } },
    );

    expect(result.outcome).toBe('success');
    expect(resolve).toHaveBeenCalledExactlyOnceWith('metrics');
    expect(vi.mocked(runAgent).mock.calls[0][1].credentials).toBe(
      credentials.posthog,
    );
  });

  it('returns a decided failure when credential resolution fails before the agent starts', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('login unavailable'));

    const result = await runProgram(
      'metrics',
      { installDir: '/project' },
      { credentials: { resolve } },
    );

    expect(result).toMatchObject({
      outcome: 'failed',
      failure: { message: 'login unavailable' },
      runResults: [],
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('resolves self-driving with explicit detected tools and passes completion hooks', async () => {
    vi.mocked(getProgramConfig).mockReturnValueOnce({
      id: 'self-driving',
      description: 'Self-driving',
      steps: [],
      run: vi.fn(),
    });
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });

    const result = await runProgram('self-driving', {
      installDir: '/project',
      credentials,
      detectedTools: [
        {
          kind: 'Linear',
          label: 'Linear',
          mode: 'deep-link',
          matchedSignal: 'dependency: @linear/sdk',
        },
      ],
    });

    expect(result.outcome).toBe('success');
    const [config] = vi.mocked(runAgent).mock.calls[0];
    expect(config.run.skillId).toBe('self-driving-setup');
    expect(config.run.customPrompt?.(credentials.posthog)).toContain('Linear');
    expect(config.hooks?.buildOutroData).toBeTypeOf('function');
  });

  it('requires prepared framework data and host effects for callable integration', async () => {
    vi.mocked(getProgramConfig).mockReturnValueOnce({
      id: 'posthog-integration',
      description: 'Integration',
      steps: [],
      run: vi.fn(),
    });

    const result = await runProgram('posthog-integration', {
      installDir: '/project',
      credentials,
    });

    expect(result).toMatchObject({
      outcome: 'failed',
      failure: { message: expect.stringContaining('framework') },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('passes the integration recipe, hooks, and seeded tasks to the agent', async () => {
    vi.mocked(getProgramConfig).mockReturnValueOnce({
      id: 'posthog-integration',
      description: 'Integration',
      steps: [],
      run: vi.fn(),
    });
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const frameworkConfig = {
      metadata: { name: 'Next.js', integration: 'nextjs', docsUrl: 'docs' },
      detection: { usesPackageJson: false, getVersion: () => '15' },
      analytics: { getTags: () => ({}) },
      prompts: { projectTypeDetection: 'app' },
      environment: { uploadToHosting: false, getEnvVars: () => ({}) },
      ui: {
        successMessage: 'Done',
        estimatedDurationMinutes: 5,
        getOutroChanges: () => [],
      },
    } as unknown as FrameworkConfig;
    const effects = {
      readPackageJson: vi.fn().mockResolvedValue(null),
      hasDeclaredDependency: vi.fn().mockReturnValue(true),
      warn: vi.fn(),
      setTag: vi.fn(),
      capture: vi.fn(),
      uploadEnvironmentVariables: vi.fn().mockResolvedValue([]),
      requestDeepLink: vi.fn().mockResolvedValue(null),
      openDashboardDeepLink: vi.fn(),
    };

    const result = await runProgram(
      'posthog-integration',
      {
        installDir: '/project',
        credentials,
        frameworkConfig,
        frameworkContext: {},
        flags: { ci: true },
      },
      { integrationEffects: effects },
    );

    expect(result.outcome).toBe('success');
    const [config] = vi.mocked(runAgent).mock.calls[0];
    expect(config.run.integrationLabel).toBe('nextjs');
    expect(config.hooks?.buildOutroData).toBeTypeOf('function');
    expect(config.seedTasks?.()).toEqual([]);
  });
});
