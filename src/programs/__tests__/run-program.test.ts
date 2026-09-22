import { runAgent, RunOutcome } from '@agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EVENT_PLAN_FILE, Harness, Sequence } from '@shared/constants';
import { AUDIT_CHECKS_FILE } from '@shared/audit-ledger';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import type { FrameworkConfig } from '../framework-config';
import type { ResolvedProgramCredentials } from '../credentials';
import { ErrorCodes } from '@shared/errors';
import { getRuntimeProgramConfig } from '../runtime-registry';
import * as auditWatcher from '../audit/watch-ledger';
import { ProgramEventPlanWatcher } from '../posthog-integration/watch-event-plan';
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
vi.mock('../runtime-registry', () => ({
  getRuntimeProgramConfig: vi.fn(),
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

const credentials: ResolvedProgramCredentials = {
  posthog: {
    accessToken: 'phx_access_test',
    projectApiKey: 'phx_test',
    projectId: 42,
    host: HostResolution.fromRegion('us'),
  },
  inferenceAuth: { resolve: vi.fn() },
  project: null,
  apiUser: {
    organization: { is_ai_data_processing_approved: true },
  } as ApiUser,
};

describe('runProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'metrics',
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
      progress: {
        runs: [
          {
            runId: 'run-1',
            phase: 'finished',
            outcome: 'success',
            snapshot: { statusMessages: ['Metrics configured'] },
          },
        ],
      },
      data: {
        credentials: { projectId: 42 },
      },
      settledRuns: [{ runId: 'run-1', result: { outcome: 'success' } }],
      artifacts: { reportFile: '/project/posthog-metrics-report.md' },
    });
  });

  it('returns a decided failure for an unknown program before invoking the agent', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce(undefined as never);

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
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'events-audit',
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

  it('seeds and observes this audit run’s ledger, then releases its watcher', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-audit-host-'),
    );
    const ledgerFile = path.join(installDir, AUDIT_CHECKS_FILE);
    const stale = [
      { id: 'old', area: 'Events', label: 'old', status: 'pending' as const },
    ];
    const seed = [
      { id: 'seed', area: 'Events', label: 'seed', status: 'pending' as const },
    ];
    const updated = [
      { id: 'seed', area: 'Events', label: 'seed', status: 'pass' as const },
    ];
    fs.writeFileSync(ledgerFile, JSON.stringify(stale));
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'audit',
      auditLedgerFile: AUDIT_CHECKS_FILE,
      auditSeedChecks: seed,
    });
    const originalWatch = auditWatcher.watchAuditLedger;
    const stop = vi.fn();
    const watcherSpy = vi
      .spyOn(auditWatcher, 'watchAuditLedger')
      .mockImplementation((...args) => {
        const handle = originalWatch(...args);
        return {
          refresh: () => handle.refresh(),
          stop: () => {
            stop();
            handle.stop();
          },
        };
      });
    vi.mocked(runAgent).mockImplementation(() => {
      expect(JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))).toEqual(seed);
      fs.writeFileSync(ledgerFile, JSON.stringify(updated));
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    try {
      const result = await runProgram('audit', {
        installDir,
        credentials,
        run,
      });

      expect(result.outcome).toBe(RunOutcome.Success);
      expect(result.data.detection.frameworkContext.auditChecks).toEqual(
        updated,
      );
      expect(watcherSpy).toHaveBeenCalledExactlyOnceWith(
        installDir,
        AUDIT_CHECKS_FILE,
        expect.any(Function),
      );
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      watcherSpy.mockRestore();
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  it('returns the current integration event plan and stops its watcher on settlement', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-plan-host-'),
    );
    const planFile = path.join(installDir, EVENT_PLAN_FILE);
    fs.writeFileSync(planFile, JSON.stringify([{ event_name: 'stale' }]));
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'posthog-integration',
      eventPlanFile: EVENT_PLAN_FILE,
    });
    const stop = vi.spyOn(ProgramEventPlanWatcher.prototype, 'stop');
    vi.mocked(runAgent).mockImplementation(() => {
      fs.writeFileSync(
        planFile,
        JSON.stringify([{ event_name: 'checkout_started', description: 'A' }]),
      );
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    try {
      const result = await runProgram('posthog-integration', {
        installDir,
        credentials,
        run,
      });

      expect(result.data.eventPlan).toEqual([
        { name: 'checkout_started', description: 'A' },
      ]);
      // First capture stops its own watch; the host still drains lifecycle.
      expect(stop).toHaveBeenCalledTimes(2);
    } finally {
      stop.mockRestore();
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  it('releases an uncaptured event-plan watcher when the agent throws', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-plan-error-'),
    );
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'posthog-integration',
      eventPlanFile: EVENT_PLAN_FILE,
    });
    const stop = vi.spyOn(ProgramEventPlanWatcher.prototype, 'stop');
    vi.mocked(runAgent).mockRejectedValue(new Error('agent crashed'));

    try {
      await expect(
        runProgram('posthog-integration', {
          installDir,
          credentials,
          run,
        }),
      ).rejects.toThrow('agent crashed');
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      stop.mockRestore();
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  it('runs a no-agent program through a host capability without credentials', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'mcp-add',
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

  it('blocks an AI program before agent start without org approval or a host approval capability', async () => {
    const result = await runProgram('metrics', {
      installDir: '/project',
      credentials: { ...credentials, apiUser: null },
    });

    expect(result).toMatchObject({
      outcome: 'failed',
      failure: { message: expect.stringContaining('AI') },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('waits for explicit host AI approval and only runs when granted', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const awaitAiApproval = vi.fn().mockResolvedValue(true);

    const result = await runProgram(
      'metrics',
      {
        installDir: '/project',
        credentials: { ...credentials, apiUser: null },
      },
      { awaitAiApproval },
    );

    expect(result.outcome).toBe('success');
    expect(awaitAiApproval).toHaveBeenCalledExactlyOnceWith({
      programId: 'metrics',
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('preserves a host-prepared run policy for legacy and custom adapters', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const postRun = vi.fn();

    await runProgram('metrics', {
      installDir: '/project',
      credentials,
      allowedTools: ['Agent', 'special-tool'],
      disallowedTools: ['unsafe-tool'],
      agentFlow: 'custom-flow',
      hooks: { postRun },
    });

    expect(vi.mocked(runAgent).mock.calls[0][0]).toMatchObject({
      allowedTools: ['Agent', 'special-tool'],
      disallowedTools: ['unsafe-tool'],
      agentFlow: 'custom-flow',
      hooks: { postRun },
    });
  });

  it('settles a pre-aborted host signal before credentials or agent startup', async () => {
    const controller = new AbortController();
    controller.abort();
    const resolve = vi.fn();

    const result = await runProgram(
      'metrics',
      { installDir: '/project' },
      { credentials: { resolve }, signal: controller.signal },
    );

    expect(result).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { code: ErrorCodes.AgentAbort },
      settledRuns: [],
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('resolves self-driving with explicit detected tools and passes completion hooks', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'self-driving',
    });
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });

    const result = await runProgram('self-driving', {
      installDir: '/project',
      credentials,
      composition: { githubConnected: true },
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

  it('requires a confirmed GitHub connection before self-driving starts', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'self-driving',
    });

    const result = await runProgram('self-driving', {
      installDir: '/project',
      credentials,
    });

    expect(result).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { message: 'GitHub connection was not confirmed.' },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('requires prepared framework data and host effects for callable integration', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'posthog-integration',
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
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'posthog-integration',
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

  it('composes an integration run before self-driving with one attributed ledger', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation((id) => ({
      id,
    }));
    vi.mocked(runAgent).mockImplementation((config, _input, options) => {
      options?.onProgress?.({ kind: 'status', message: config.programId });
      return Promise.resolve({
        outcome: RunOutcome.Success,
        skillId: config.programId,
        snapshot: {
          ...snapshot,
          statusMessages: [config.programId],
        },
      });
    });
    const observed: unknown[] = [];

    const result = await runProgram(
      'self-driving',
      {
        installDir: '/project',
        runId: 'parent',
        credentials,
        composition: {
          integration: {
            installDir: '/project/app',
            run: { ...run, integrationLabel: 'nextjs' },
          },
          handoffConfirmed: true,
          githubConnected: true,
        },
      },
      { onProgress: (event) => observed.push(event) },
    );

    expect(
      vi.mocked(runAgent).mock.calls.map(([config]) => config.programId),
    ).toEqual(['posthog-integration', 'self-driving']);
    expect(vi.mocked(runAgent).mock.calls[0][0].composed).toBe(true);
    expect(vi.mocked(runAgent).mock.calls[0][1].installDir).toBe(
      '/project/app',
    );
    expect(observed).toMatchObject([
      { runId: 'parent:integrate-run', stepId: 'integrate-run' },
      { runId: 'parent' },
    ]);
    expect(result.runResults.map((item) => item.skillId)).toEqual([
      'posthog-integration',
      'self-driving',
    ]);
    expect(result.settledRuns.map((item) => item.runId)).toEqual([
      'parent:integrate-run',
      'parent',
    ]);
    expect(result.data.composition.completedRuns).toContain('integrate-run');
  });

  it('stops the composed run when the child fails', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation((id) => ({
      id,
    }));
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Failed,
      failure: { message: 'integration failed' },
      snapshot,
    });

    const result = await runProgram('self-driving', {
      installDir: '/project',
      credentials,
      composition: {
        integration: {
          installDir: '/project/app',
          run: { ...run, integrationLabel: 'nextjs' },
        },
      },
    });

    expect(result).toMatchObject({
      programId: 'self-driving',
      outcome: 'failed',
      failure: { message: 'integration failed' },
      settledRuns: [{ stepId: 'integrate-run' }],
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('turns a rejected composition gate into a decided failure', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation((id) => ({
      id,
    }));
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });

    const result = await runProgram(
      'self-driving',
      {
        installDir: '/project',
        credentials,
        composition: {
          integration: {
            installDir: '/project/app',
            run: { ...run, integrationLabel: 'nextjs' },
          },
        },
      },
      {
        compositionWorkflow: {
          confirmStep: vi.fn().mockRejectedValue(new Error('workflow closed')),
        },
      },
    );

    expect(result).toMatchObject({
      outcome: 'failed',
      failure: { message: 'workflow closed' },
      settledRuns: [{ stepId: 'integrate-run' }],
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('cleans a child skill if a later composition gate aborts', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-compose-'),
    );
    const childDir = path.join(installDir, 'app');
    const skillRoot = path.join(childDir, '.claude', 'skills');
    const oldSkill = path.join(skillRoot, 'before-run');
    const newSkill = path.join(skillRoot, 'during-run');
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.writeFileSync(path.join(oldSkill, '.posthog-wizard'), '');
    vi.mocked(getRuntimeProgramConfig).mockImplementation((id) => ({ id }));
    vi.mocked(runAgent).mockImplementation(() => {
      fs.mkdirSync(newSkill);
      fs.writeFileSync(path.join(newSkill, '.posthog-wizard'), '');
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    try {
      const result = await runProgram(
        'self-driving',
        {
          installDir,
          credentials,
          composition: {
            integration: {
              installDir: childDir,
              run: { ...run, integrationLabel: 'nextjs' },
            },
          },
        },
        {
          compositionWorkflow: {
            confirmStep: vi.fn().mockResolvedValue(false),
          },
        },
      );

      expect(result.outcome).toBe(RunOutcome.Aborted);
      expect(fs.existsSync(newSkill)).toBe(false);
      expect(fs.existsSync(oldSkill)).toBe(true);
      expect(runAgent).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });
});
