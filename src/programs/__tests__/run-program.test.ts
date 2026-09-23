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
import type { ProgramProgress } from '../program-store';
import type {
  ProgramWorkflowConnector,
  ProgramWorkflowDecision,
  ProgramWorkflowRequest,
} from '../run-program';
import { ErrorCodes } from '@shared/errors';
import {
  getRuntimeProgramConfig,
  type RuntimeProgramConfig,
} from '../runtime-registry';
import {
  resolveAgentSkillRunDefinition,
  resolveProgramRunDefinition,
} from '../resolve-run-definition';
import * as auditWatcher from '../audit/watch-ledger';
import { ProgramEventPlanWatcher } from '../posthog-integration/watch-event-plan';
import { runProgram } from '@programs';
import { analytics } from '@utils/analytics';
import { refreshAccessToken } from '@utils/oauth-token';
import { DiscoveredFeature } from '@shared/scan-consent';
import { captureSwitchboardDecision } from '../binding-telemetry';
import { gatewayAuth } from '../gateway-session';

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
vi.mock('../binding-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../binding-telemetry')>();
  return {
    ...actual,
    captureSwitchboardDecision: vi.fn(actual.captureSwitchboardDecision),
  };
});
vi.mock('../runtime-registry', () => ({
  getRuntimeProgramConfig: vi.fn(),
}));
vi.mock('@utils/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/analytics')>()),
  analytics: {
    runId: 'analytics-run-id',
    build: 'test',
    setTag: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    identifyUser: vi.fn(),
    setGroups: vi.fn(),
    groupIdentify: vi.fn(),
  },
}));
vi.mock('@utils/oauth-token', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('../gateway-session', () => ({ gatewayAuth: vi.fn() }));

const run = {
  integrationLabel: 'metrics',
  spinnerMessage: 'Configuring metrics',
  successMessage: 'Metrics configured',
  estimatedDurationMinutes: 5,
  reportFile: 'posthog-metrics-report.md',
  docsUrl: 'https://posthog.com/docs/metrics',
};

const composedRuntimeConfig = (id: string): RuntimeProgramConfig =>
  id === 'self-driving'
    ? {
        id,
        strategy: 'self-driving',
        composedRuns: [
          { stepId: 'integrate-run', runProgramId: 'posthog-integration' },
        ],
      }
    : { id, strategy: 'integration' };

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
      strategy: 'static',
      run,
    });
  });

  it('calls a static program with explicit inputs and returns attributed progress and final results', async () => {
    const observed: ProgramProgress[] = [];
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
    expect(observed.filter((progress) => progress.kind === 'run')).toEqual([
      {
        kind: 'run',
        runId: 'run-1',
        event: { kind: 'status', message: 'Metrics configured' },
      },
    ]);
    expect(observed[0]).toMatchObject({
      kind: 'program',
      data: { credentials: { projectId: 42 } },
    });
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

  it('every run carries the standard trace tags', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });

    await runProgram('metrics', {
      installDir: '/project',
      credentials,
      binding: {
        sequence: Sequence.linear,
        harness: Harness.anthropic,
        model: 'claude-test',
      },
    });

    expect(vi.mocked(runAgent).mock.calls[0][0].wizardMetadata).toEqual({
      program_id: 'metrics',
      integration: 'metrics',
      run_id: 'analytics-run-id',
      build: 'test',
      call_type: 'agent',
      SEQUENCE: Sequence.linear,
      HARNESS: Harness.anthropic,
    });
  });

  it('lets input metadata override the standard tags but not the route', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });

    await runProgram('metrics', {
      installDir: '/project',
      credentials,
      run: { ...run, skillId: 'metrics-skill' },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.anthropic,
        model: 'claude-test',
      },
      wizardMetadata: { run_id: 'host-run', SEQUENCE: 'not-the-route' },
    });

    expect(vi.mocked(runAgent).mock.calls[0][0].wizardMetadata).toMatchObject({
      program_id: 'metrics',
      skill_id: 'metrics-skill',
      run_id: 'host-run',
      SEQUENCE: Sequence.linear,
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
      strategy: 'resolved',
      resolve: (input) => resolveProgramRunDefinition('events-audit', input),
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

  it('runs a generic agent skill from an explicit skill ID without a TUI session', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'agent-skill',
      strategy: 'resolved',
      resolve: (input) => resolveAgentSkillRunDefinition(input.skillId),
      allowedTools: ['Agent'],
    });
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      skillId: 'autocapture',
      snapshot,
    });

    const result = await runProgram('agent-skill', {
      installDir: '/project',
      credentials,
      skillId: 'autocapture',
    });

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(vi.mocked(runAgent).mock.calls[0][0].run).toMatchObject({
      skillId: 'autocapture',
      integrationLabel: 'autocapture',
      reportFile: 'posthog-autocapture-report.md',
    });
    expect(vi.mocked(runAgent).mock.calls[0][1].skillId).toBe('autocapture');
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
      strategy: 'resolved',
      resolve: (input) => resolveProgramRunDefinition('audit', input),
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

  it('watches the audit ledger a host lays over a program without one', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-audit-overlay-'),
    );
    const checks = [
      { id: 'events', area: 'Events', label: 'Events', status: 'pass' },
    ];
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'agent-skill',
      strategy: 'resolved',
      resolve: (input) => resolveAgentSkillRunDefinition(input.skillId),
    });
    vi.mocked(runAgent).mockImplementation(() => {
      fs.writeFileSync(
        path.join(installDir, AUDIT_CHECKS_FILE),
        JSON.stringify(checks),
      );
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    try {
      const result = await runProgram('agent-skill', {
        installDir,
        credentials,
        run,
        auditLedgerFile: AUDIT_CHECKS_FILE,
      });

      expect(result.data.detection.frameworkContext.auditChecks).toEqual(
        checks,
      );
    } finally {
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
      strategy: 'integration',
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
      strategy: 'integration',
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
      strategy: 'no-agent',
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

  it('aborts a no-agent workflow when the host cancels during the callback', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'mcp-tutorial',
      strategy: 'no-agent',
      requiresAi: false,
    });
    const controller = new AbortController();
    let complete!: (value: { outcome: 'success' }) => void;
    const workflow = vi.fn(
      () =>
        new Promise<{ outcome: 'success' }>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = runProgram(
      'mcp-tutorial',
      { installDir: '/project' },
      { noAgentWorkflow: workflow, signal: controller.signal },
    );

    await vi.waitFor(() => expect(workflow).toHaveBeenCalledOnce());
    expect(workflow).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
    controller.abort();
    complete({ outcome: 'success' });

    expect(await pending).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { code: ErrorCodes.AgentAbort },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('does not start a no-agent workflow after cancellation during credential resolution', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'mcp-tutorial',
      strategy: 'no-agent',
      requiresAi: false,
    });
    const controller = new AbortController();
    let complete!: (value: ResolvedProgramCredentials) => void;
    const resolve = vi.fn(
      () =>
        new Promise<ResolvedProgramCredentials>((done) => {
          complete = done;
        }),
    );
    const workflow = vi.fn().mockResolvedValue({ outcome: 'success' });
    const pending = runProgram(
      'mcp-tutorial',
      { installDir: '/project' },
      {
        credentials: { resolve },
        noAgentWorkflow: workflow,
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    controller.abort();
    complete(credentials);

    expect(await pending).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { code: ErrorCodes.AgentAbort },
    });
    expect(workflow).not.toHaveBeenCalled();
  });

  it('overrides reach the binding and the decision is captured once', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const setTag = vi.mocked(analytics.setTag);
    const observed: ProgramProgress[] = [];

    const result = await runProgram(
      'metrics',
      {
        installDir: '/project',
        credentials,
        overrides: { harness: Harness.anthropic, sequence: Sequence.linear },
      },
      { onProgress: (progress) => observed.push(progress) },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    const binding = vi.mocked(runAgent).mock.calls[0][0].binding;
    expect(binding).toMatchObject({
      sequence: Sequence.linear,
      harness: Harness.anthropic,
    });
    expect(captureSwitchboardDecision).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        program: 'metrics',
        cliHarness: Harness.anthropic,
        cliSequence: Sequence.linear,
      }),
      binding,
    );
    expect(setTag).toHaveBeenCalledWith('sequence', Sequence.linear);
    expect(setTag).toHaveBeenCalledWith('harness', Harness.anthropic);
    expect(
      setTag.mock.calls.filter(
        ([key]) => key === 'sequence' || key === 'harness',
      ),
    ).toHaveLength(2);
    expect(observed).toContainEqual({
      kind: 'program',
      data: expect.objectContaining({ binding }),
    });
    expect(result.data.binding).toEqual(binding);
  });

  it('uses a host-resolved binding without capturing the decision again', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const setTag = vi.mocked(analytics.setTag);
    const binding = {
      sequence: Sequence.linear,
      harness: Harness.anthropic,
      model: 'claude-test',
    };

    const result = await runProgram('metrics', {
      installDir: '/project',
      credentials,
      binding,
      overrides: { harness: Harness.pi },
    });

    expect(vi.mocked(runAgent).mock.calls[0][0].binding).toBe(binding);
    expect(captureSwitchboardDecision).not.toHaveBeenCalled();
    expect(setTag).not.toHaveBeenCalledWith('harness', expect.anything());
    expect(result.data.binding).toEqual(binding);
  });

  it('flags load after credentials resolve and AI approval', async () => {
    const order: string[] = [];
    vi.mocked(runAgent).mockImplementation(() => {
      order.push('runAgent');
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const resolve = vi.fn(() => {
      order.push('credentials');
      return Promise.resolve({ ...credentials, apiUser: null });
    });
    const awaitAiApproval = vi.fn(() => {
      order.push('approval');
      return Promise.resolve(true);
    });
    const featureFlags = vi.fn(() => {
      order.push('flags');
      return Promise.resolve({
        flags: { 'wizard-test-flag': 'on' },
        payloads: { 'wizard-test-flag': { variant: 'b' } },
      });
    });

    const result = await runProgram(
      'metrics',
      { installDir: '/project' },
      { credentials: { resolve }, awaitAiApproval, featureFlags },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(order).toEqual(['credentials', 'approval', 'flags', 'runAgent']);
    expect(vi.mocked(runAgent).mock.calls[0][0]).toMatchObject({
      wizardFlags: { 'wizard-test-flag': 'on' },
      wizardFlagPayloads: { 'wizard-test-flag': { variant: 'b' } },
    });
  });

  it('captures agent started before credentials resolve, for agent programs only', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const resolve = vi.fn().mockResolvedValue(credentials);
    const capture = vi.mocked(analytics.wizardCapture);
    const started = () =>
      capture.mock.calls.flatMap(([event, properties], index) =>
        event === 'agent started'
          ? [{ properties, at: capture.mock.invocationCallOrder[index] }]
          : [],
      );

    await runProgram(
      'metrics',
      {
        installDir: '/project',
        run: { ...run, integrationLabel: 'custom-label', skillId: 'skill-x' },
      },
      { credentials: { resolve } },
    );
    await runProgram(
      'replay-vision',
      { installDir: '/project' },
      { credentials: { resolve } },
    );
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'mcp-add',
      strategy: 'no-agent',
      requiresAi: false,
    });
    await runProgram(
      'mcp-add',
      { installDir: '/project' },
      {
        mcp: {
          detectSupportedClients: vi.fn().mockResolvedValue([]),
          add: vi.fn().mockResolvedValue([]),
          detectInstalledClients: vi.fn(),
          remove: vi.fn(),
        },
      },
    );

    expect(started().map(({ properties }) => properties)).toEqual([
      {
        integration: 'custom-label',
        program_id: 'metrics',
        skill_id: 'skill-x',
      },
      {
        integration: 'replay-vision',
        program_id: 'replay-vision',
        skill_id: null,
      },
    ]);
    const [first, second] = started();
    expect(first.at).toBeLessThan(resolve.mock.invocationCallOrder[0]);
    expect(second.at).toBeLessThan(resolve.mock.invocationCallOrder[1]);
  });

  it('refreshes an aging token after the flags load and before the route is tagged', async () => {
    const order: string[] = [];
    vi.mocked(refreshAccessToken).mockImplementationOnce(() => {
      order.push('refresh');
      return Promise.resolve({
        access_token: 'pha_refreshed',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'project:read',
      });
    });
    vi.mocked(runAgent).mockImplementation(() => {
      order.push('runAgent');
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const featureFlags = vi.fn(() => {
      order.push('flags');
      return Promise.resolve({ flags: {}, payloads: {} });
    });

    await runProgram(
      'metrics',
      {
        installDir: '/project',
        credentials: {
          ...credentials,
          posthog: {
            ...credentials.posthog,
            refreshToken: 'phr_aging',
            expiresAt: Date.now() + 10 * 60 * 1000,
          },
        },
      },
      { featureFlags },
    );

    expect(order).toEqual(['flags', 'refresh', 'runAgent']);
    const setTag = vi.mocked(analytics.setTag).mock;
    const tagged =
      setTag.invocationCallOrder[
        setTag.calls.findIndex(([key]) => key === 'sequence')
      ];
    expect(
      vi.mocked(refreshAccessToken).mock.invocationCallOrder[0],
    ).toBeLessThan(tagged);
    expect(captureSwitchboardDecision).toHaveBeenCalledOnce();
    expect(
      vi.mocked(captureSwitchboardDecision).mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      vi.mocked(refreshAccessToken).mock.invocationCallOrder[0],
    );
  });

  it('prefers the input flags over the loader', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const featureFlags = vi.fn();

    await runProgram(
      'metrics',
      {
        installDir: '/project',
        credentials,
        wizardFlags: { 'wizard-test-flag': 'input' },
      },
      { featureFlags },
    );

    expect(featureFlags).not.toHaveBeenCalled();
    expect(vi.mocked(runAgent).mock.calls[0][0].wizardFlags).toEqual({
      'wizard-test-flag': 'input',
    });
  });

  it('returns a decided failure when the flag loader rejects', async () => {
    const featureFlags = vi
      .fn()
      .mockRejectedValue(new Error('malformed CI flag override'));

    const result = await runProgram(
      'metrics',
      { installDir: '/project', credentials },
      { featureFlags },
    );

    expect(result).toMatchObject({
      outcome: RunOutcome.Failed,
      failure: { message: 'malformed CI flag override' },
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
    expect(resolve).toHaveBeenCalledExactlyOnceWith('metrics', {
      signal: expect.objectContaining({ aborted: false }),
    });
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
      signal: expect.objectContaining({ aborted: false }),
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('aborts before agent startup when host AI approval is declined', async () => {
    const awaitAiApproval = vi.fn().mockResolvedValue(false);

    const result = await runProgram(
      'metrics',
      {
        installDir: '/project',
        credentials: { ...credentials, apiUser: null },
      },
      { awaitAiApproval },
    );

    expect(result).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { message: 'AI processing approval declined.' },
    });
    expect(awaitAiApproval).toHaveBeenCalledExactlyOnceWith({
      programId: 'metrics',
      signal: expect.objectContaining({ aborted: false }),
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('passes the invocation signal to the provider and to the AI approval wait', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const controller = new AbortController();
    const resolve = vi
      .fn()
      .mockResolvedValue({ ...credentials, apiUser: null });
    const awaitAiApproval = vi.fn().mockResolvedValue(true);

    const result = await runProgram(
      'metrics',
      { installDir: '/project' },
      {
        credentials: { resolve },
        awaitAiApproval,
        signal: controller.signal,
      },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(resolve).toHaveBeenCalledExactlyOnceWith('metrics', {
      signal: controller.signal,
    });
    expect(awaitAiApproval).toHaveBeenCalledExactlyOnceWith({
      programId: 'metrics',
      signal: controller.signal,
    });
  });

  it('a host abort while approval is pending returns Aborted', async () => {
    const controller = new AbortController();
    const awaitAiApproval = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error('approval screen closed')),
          );
        }),
    );

    const pending = runProgram(
      'metrics',
      {
        installDir: '/project',
        credentials: { ...credentials, apiUser: null },
      },
      { awaitAiApproval, signal: controller.signal },
    );
    await vi.waitFor(() => expect(awaitAiApproval).toHaveBeenCalledOnce());
    controller.abort();

    expect(await pending).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: {
        code: ErrorCodes.AgentAbort,
        message: 'Run cancelled by host.',
      },
    });
    expect(runAgent).not.toHaveBeenCalled();
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

  it('forwards a live host signal to the agent and retains its aborted result', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(runAgent).mockImplementation((_config, _input, options) => {
      expect(options?.signal).toBe(controller.signal);
      return new Promise((resolve) => {
        options?.signal?.addEventListener('abort', () => {
          resolve({
            outcome: RunOutcome.Aborted,
            failure: { code: ErrorCodes.AgentAbort, message: 'Host cancelled' },
            snapshot,
          });
        });
        started();
      });
    });

    const pending = runProgram(
      'metrics',
      { installDir: '/project', credentials },
      { signal: controller.signal },
    );
    await entered;
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { code: ErrorCodes.AgentAbort },
      settledRuns: [{ result: { outcome: RunOutcome.Aborted } }],
    });
    expect(result.data.composition.completedRuns).not.toContain('metrics');
  });

  it('resolves self-driving with explicit detected tools and passes completion hooks', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'self-driving',
      strategy: 'self-driving',
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
      strategy: 'self-driving',
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
      strategy: 'integration',
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
      strategy: 'integration',
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
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
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
    const observed: ProgramProgress[] = [];

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
    expect(
      observed.filter((progress) => progress.kind === 'run'),
    ).toMatchObject([
      { kind: 'run', runId: 'parent:integrate-run', stepId: 'integrate-run' },
      { kind: 'run', runId: 'parent' },
    ]);
    expect(
      observed.filter((progress) => progress.kind === 'program').at(-1),
    ).toEqual({ kind: 'program', data: result.data });
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

  it('passes overrides to a composed child and loads its flags when neither input has them', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const featureFlags = vi
      .fn()
      .mockResolvedValue({ flags: { 'wizard-test-flag': 'on' }, payloads: {} });

    const result = await runProgram(
      'self-driving',
      {
        installDir: '/project',
        credentials,
        overrides: { harness: Harness.anthropic },
        composition: {
          integration: {
            installDir: '/project/app',
            run: { ...run, integrationLabel: 'nextjs' },
          },
          handoffConfirmed: true,
          githubConnected: true,
        },
      },
      { featureFlags },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(featureFlags).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(runAgent)
        .mock.calls.map(([config]) => [
          config.programId,
          config.binding.harness,
          config.wizardFlags,
        ]),
    ).toEqual([
      ['posthog-integration', Harness.anthropic, { 'wizard-test-flag': 'on' }],
      ['self-driving', Harness.anthropic, { 'wizard-test-flag': 'on' }],
    ]);
  });

  it('a provider is resolved once, then stamped, and refreshed before the agent starts', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({
      access_token: 'pha_refreshed',
      refresh_token: 'phr_rotated',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'project:read',
    });
    const aging = {
      ...credentials.posthog,
      accessToken: 'pha_aging',
      refreshToken: 'phr_aging',
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    const apiUser = {
      distinct_id: 'user-1',
      organization: { id: 'org-1', is_ai_data_processing_approved: true },
    } as ApiUser;
    const resolve = vi
      .fn()
      .mockResolvedValue({ posthog: aging, project: null, apiUser });
    const observed: ProgramProgress[] = [];

    const result = await runProgram(
      'self-driving',
      {
        installDir: '/project',
        host: { baseUrl: 'https://posthog.example' },
        mayReportScanResults: true,
        discoveredFeatures: [DiscoveredFeature.LLM],
        composition: {
          integration: {
            installDir: '/project/app',
            run: { ...run, integrationLabel: 'nextjs' },
          },
          handoffConfirmed: true,
          githubConnected: true,
        },
      },
      {
        credentials: { resolve },
        onProgress: (progress) => observed.push(progress),
      },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(resolve).toHaveBeenCalledOnce();
    expect(analytics.identifyUser).toHaveBeenCalledWith(apiUser);
    expect(analytics.groupIdentify).toHaveBeenCalledExactlyOnceWith(
      'organization',
      'org-1',
      { wizard_ai_sdk_detected: true },
    );
    expect(refreshAccessToken).toHaveBeenCalledExactlyOnceWith(
      'phr_aging',
      'https://posthog.example',
      undefined,
    );
    expect(
      vi
        .mocked(runAgent)
        .mock.calls.map(([config, input]) => [
          config.programId,
          input.credentials.accessToken,
        ]),
    ).toEqual([
      ['posthog-integration', 'pha_refreshed'],
      ['self-driving', 'pha_refreshed'],
    ]);
    expect(observed).toContainEqual({
      kind: 'program',
      data: expect.objectContaining({
        credentials: expect.objectContaining({
          accessToken: 'pha_refreshed',
          refreshToken: 'phr_rotated',
        }),
      }),
    });
    expect(result.data.aiSdkStampReported).toBe(true);

    await vi.mocked(runAgent).mock.calls[1][1].inferenceAuth.resolve();
    expect(gatewayAuth).toHaveBeenCalledExactlyOnceWith(
      aging.host,
      'pha_refreshed',
      'self-driving',
    );
  });

  it('leaves a stamp the host already reported and a fresh token alone', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const fresh = {
      ...credentials,
      posthog: {
        ...credentials.posthog,
        refreshToken: 'phr_fresh',
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      },
      apiUser: {
        organization: { id: 'org-1', is_ai_data_processing_approved: true },
      } as ApiUser,
    };

    const result = await runProgram('metrics', {
      installDir: '/project',
      credentials: fresh,
      aiSdkStampReported: true,
      mayReportScanResults: true,
      discoveredFeatures: [DiscoveredFeature.LLM],
    });

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(analytics.groupIdentify).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    const [, input] = vi.mocked(runAgent).mock.calls[0];
    expect(input.credentials).toEqual(fresh.posthog);
    expect(input.inferenceAuth).toBe(credentials.inferenceAuth);
    expect(result.data.aiSdkStampReported).toBe(true);
  });

  it('stops the composed run when the child fails', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Failed,
      failure: {
        code: ErrorCodes.AgentApiError,
        message: 'integration failed',
      },
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

  it('requires handoff confirmation after a successful composed integration', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
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
        githubConnected: true,
      },
    });

    expect(result).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { message: 'Self-driving handoff was not confirmed.' },
      settledRuns: [
        { stepId: 'integrate-run', result: { outcome: RunOutcome.Success } },
      ],
    });
    expect(
      vi.mocked(runAgent).mock.calls.map(([config]) => config.programId),
    ).toEqual(['posthog-integration']);
  });

  it('a fixture connector composes self-driving without the TUI', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const requests: ProgramWorkflowRequest[] = [];
    const workflow: ProgramWorkflowConnector = {
      step: vi.fn((request: ProgramWorkflowRequest) => {
        requests.push(request);
        const decision: ProgramWorkflowDecision =
          request.kind === 'child-run'
            ? {
                kind: 'child-run',
                input: {
                  installDir: '/project/app',
                  run: { ...run, integrationLabel: 'nextjs' },
                },
              }
            : { kind: 'confirm', confirmed: true };
        return Promise.resolve(decision);
      }),
    };

    const result = await runProgram(
      'self-driving',
      { installDir: '/project', runId: 'parent', credentials },
      { workflow },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(requests).toEqual([
      {
        kind: 'child-run',
        programId: 'self-driving',
        stepId: 'integrate-run',
        runProgramId: 'posthog-integration',
        installDir: '/project',
      },
      {
        kind: 'confirm',
        programId: 'self-driving',
        id: 'self-driving-handoff',
        installDir: '/project',
      },
      {
        kind: 'confirm',
        programId: 'self-driving',
        id: 'self-driving-github',
        installDir: '/project',
      },
    ]);
    expect(workflow.step).toHaveBeenCalledWith(expect.anything(), {
      signal: expect.objectContaining({ aborted: false }),
    });
    expect(
      vi
        .mocked(runAgent)
        .mock.calls.map(([config, input]) => [
          config.programId,
          input.installDir,
        ]),
    ).toEqual([
      ['posthog-integration', '/project/app'],
      ['self-driving', '/project'],
    ]);
    expect(result.settledRuns.map((settled) => settled.stepId)).toEqual([
      'integrate-run',
      undefined,
    ]);
    expect(result.data.composition.completedRuns).toContain('integrate-run');
  });

  it('skips the child and its handoff when the host ran the child itself', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const step = vi.fn(
      (request: ProgramWorkflowRequest): Promise<ProgramWorkflowDecision> =>
        Promise.resolve(
          request.kind === 'child-run'
            ? { kind: 'child-run', input: null }
            : { kind: 'confirm', confirmed: true },
        ),
    );

    const result = await runProgram(
      'self-driving',
      { installDir: '/project', credentials },
      { workflow: { step } },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(step.mock.calls.map(([request]) => request.kind)).toEqual([
      'child-run',
      'confirm',
    ]);
    expect(step.mock.calls[1][0]).toMatchObject({ id: 'self-driving-github' });
    expect(
      vi.mocked(runAgent).mock.calls.map(([config]) => config.programId),
    ).toEqual(['self-driving']);
  });

  it('post-auth sends the program gates and applies the patch', async () => {
    const order: string[] = [];
    const resolve = vi.fn(() => {
      order.push('resolve');
      return run;
    });
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'error-tracking-upload-source-maps',
      strategy: 'resolved',
      resolve,
      postAuthGates: ['detect'],
    });
    vi.mocked(runAgent).mockImplementation(() => {
      order.push('runAgent');
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const awaitAiApproval = vi.fn(() => {
      order.push('approval');
      return Promise.resolve(true);
    });
    const step = vi.fn(
      (request: ProgramWorkflowRequest): Promise<ProgramWorkflowDecision> => {
        order.push(request.kind);
        return Promise.resolve({
          kind: 'post-auth',
          frameworkContext: { selectedProject: 'apps/web' },
        });
      },
    );

    const result = await runProgram(
      'error-tracking-upload-source-maps',
      {
        installDir: '/project',
        credentials: { ...credentials, apiUser: null },
        frameworkContext: { detected: true },
      },
      { awaitAiApproval, workflow: { step } },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(order).toEqual(['approval', 'post-auth', 'resolve', 'runAgent']);
    expect(step).toHaveBeenCalledExactlyOnceWith(
      {
        kind: 'post-auth',
        programId: 'error-tracking-upload-source-maps',
        gates: [{ id: 'detect' }],
      },
      { signal: expect.objectContaining({ aborted: false }) },
    );
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        frameworkContext: { detected: true, selectedProject: 'apps/web' },
      }),
    );
    expect(result.data.detection.frameworkContext).toEqual({
      detected: true,
      selectedProject: 'apps/web',
    });
  });

  it('sends no post-auth request for a program without gates', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    const step = vi.fn();

    const result = await runProgram(
      'metrics',
      { installDir: '/project', credentials },
      { workflow: { step } },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(step).not.toHaveBeenCalled();
  });

  it('fails the run when the connector answers the wrong kind', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'metrics',
      strategy: 'static',
      run,
      postAuthGates: ['detect'],
    });
    const step = vi
      .fn()
      .mockResolvedValue({ kind: 'confirm', confirmed: true });

    const result = await runProgram(
      'metrics',
      { installDir: '/project', credentials },
      { workflow: { step } },
    );

    expect(result).toMatchObject({
      outcome: RunOutcome.Failed,
      failure: {
        message: 'Workflow connector answered confirm to a post-auth request',
      },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns cancelled when the connector rejects after a host abort', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'metrics',
      strategy: 'static',
      run,
      postAuthGates: ['detect'],
    });
    const controller = new AbortController();
    const step = vi.fn(
      (_request: ProgramWorkflowRequest, context: { signal: AbortSignal }) =>
        new Promise<ProgramWorkflowDecision>((_resolve, reject) => {
          context.signal.addEventListener('abort', () =>
            reject(new Error('gate screen closed')),
          );
        }),
    );

    const pending = runProgram(
      'metrics',
      { installDir: '/project', credentials },
      { workflow: { step }, signal: controller.signal },
    );
    await vi.waitFor(() => expect(step).toHaveBeenCalledOnce());
    controller.abort();

    expect(await pending).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { message: 'Run cancelled by host.' },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('turns a rejected composition gate into a decided failure', async () => {
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });

    const step = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'child-run',
        input: {
          installDir: '/project/app',
          run: { ...run, integrationLabel: 'nextjs' },
        },
      })
      .mockRejectedValueOnce(new Error('workflow closed'));

    const result = await runProgram(
      'self-driving',
      { installDir: '/project', credentials },
      { workflow: { step } },
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
    vi.mocked(getRuntimeProgramConfig).mockImplementation(
      composedRuntimeConfig,
    );
    vi.mocked(runAgent).mockImplementation(() => {
      fs.mkdirSync(newSkill);
      fs.writeFileSync(path.join(newSkill, '.posthog-wizard'), '');
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    try {
      const step = vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'child-run',
          input: {
            installDir: childDir,
            run: { ...run, integrationLabel: 'nextjs' },
          },
        })
        .mockResolvedValue({ kind: 'confirm', confirmed: false });

      const result = await runProgram(
        'self-driving',
        { installDir, credentials },
        { workflow: { step } },
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
