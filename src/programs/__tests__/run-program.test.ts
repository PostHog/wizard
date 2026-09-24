import { runAgent, RunOutcome } from '@agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EVENT_PLAN_FILE, Harness, Sequence } from '@shared/constants';
import { AUDIT_CHECKS_FILE, type AuditCheck } from '@shared/audit-ledger';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import type { OutroData, SeedTaskEntry } from '@agent/types';
import type { FrameworkConfig } from '../framework-config';
import type { DetectedSource } from '../warehouse-sources/types';
import type { ResolvedProgramCredentials } from '../credentials';
import type { ProgramProgress } from '../program-store';
import type {
  ProgramInput,
  ProgramOptions,
  ProgramWorkflowDecision,
  ProgramWorkflowRequest,
} from '../run-program';
import { ErrorCodes } from '@shared/errors';
import {
  getRuntimeProgramConfig,
  type RuntimeProgramConfig,
} from '../runtime-registry';
import { resolveEventsAuditRunDefinition } from '../resolve-run-definition';
import * as auditWatcher from '../audit/watch-ledger';
import { ProgramEventPlanWatcher } from '../posthog-integration/watch-event-plan';
import { runProgram } from '@programs';
import { runProgram as runProgramDirect } from '../run-program';
import { analytics } from '@utils/analytics';
import { refreshAccessToken } from '@utils/oauth-token';
import { DiscoveredFeature } from '@shared/scan-consent';
import { captureSwitchboardDecision } from '../binding-telemetry';
import { gatewayAuth } from '../gateway-session';
import { clearCleanup, runCleanups } from '@utils/cleanup-registry';
import { commitRegisteredRunSkillCleanups } from '@shared/skill-run-cleanup';

vi.mock('@agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent')>()),
  runAgent: vi.fn(),
  DEFAULT_AGENT_BINDING: {
    sequence: 'linear',
    harness: 'anthropic',
    model: 'claude-test',
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

const binding = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: 'claude-test',
};

/** A token close enough to expiry that runProgram refreshes it. */
const aging = () => ({
  ...credentials.posthog,
  accessToken: 'pha_aging',
  refreshToken: 'phr_aging',
  expiresAt: Date.now() + 10 * 60 * 1000,
});

const refreshedToken = {
  access_token: 'pha_refreshed',
  refresh_token: 'phr_rotated',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: 'project:read',
};

/** self-driving composes one posthog-integration child run. */
const composeSelfDriving = () =>
  vi.mocked(getRuntimeProgramConfig).mockImplementation((id) =>
    id === 'self-driving'
      ? {
          id,
          strategy: 'self-driving',
          composedRuns: [
            { stepId: 'integrate-run', runProgramId: 'posthog-integration' },
          ],
        }
      : { id, strategy: 'integration' },
  );

const child = (): ProgramInput => ({
  installDir: '/project/app',
  run: { ...run, integrationLabel: 'nextjs' },
});

/** A connector that hands over `input` for the child run and confirms every gate. */
const connector = (input: ProgramInput | null) => ({
  step: vi.fn(
    (request: ProgramWorkflowRequest): Promise<ProgramWorkflowDecision> =>
      Promise.resolve(
        request.kind === 'child-run'
          ? { kind: 'child-run', input }
          : { kind: 'confirm', confirmed: true },
      ),
  ),
});

/** A framework whose prompt and outro changes read the framework context. */
const integrationFrameworkConfig = (): FrameworkConfig =>
  ({
    metadata: { name: 'Next.js', integration: 'nextjs', docsUrl: 'docs' },
    detection: { usesPackageJson: false, getVersion: () => '15' },
    analytics: { getTags: () => ({}) },
    prompts: {
      projectTypeDetection: 'app',
      getAdditionalContextLines: (context: Record<string, unknown>) =>
        context.router ? [`Router: ${String(context.router)}`] : [],
    },
    environment: { uploadToHosting: false, getEnvVars: () => ({}) },
    ui: {
      successMessage: 'Done',
      estimatedDurationMinutes: 5,
      getOutroChanges: (context: Record<string, unknown>) =>
        context.router
          ? [`Configured the ${String(context.router)} router`]
          : [],
    },
  } as unknown as FrameworkConfig);

/** Integration host effects without a live notebook getter. */
const integrationEffects = () => ({
  readPackageJson: vi.fn().mockResolvedValue(null),
  warn: vi.fn(),
  uploadEnvironmentVariables: vi.fn().mockResolvedValue([]),
  openDashboardDeepLink: vi.fn(),
});

const warehouseSource = (kind: string): DetectedSource => ({
  kind,
  label: kind,
  mode: 'in-cli',
  matchedSignal: `dependency: ${kind.toLowerCase()}`,
});

const tempDirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-run-program-'));
  tempDirs.push(dir);
  return dir;
};

describe('runProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'metrics',
      strategy: 'static',
      run,
    });
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
      { installDir: '/project', runId: 'run-1', credentials },
      { onProgress: (event) => observed.push(event) },
    );

    const [config, input] = vi.mocked(runAgent).mock.calls[0];
    expect(config.run).toBe(run);
    expect(input.installDir).toBe('/project');
    expect(input.credentials).toBe(credentials.posthog);
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
      outcome: RunOutcome.Success,
      data: { credentials: { projectId: 42 } },
      settledRuns: [
        {
          runId: 'run-1',
          result: { outcome: RunOutcome.Success, skillId: 'metrics' },
        },
      ],
      diagnostics: [],
      artifacts: { reportFile: '/project/posthog-metrics-report.md' },
    });
  });

  it('every run carries the standard trace tags', async () => {
    await runProgram('metrics', {
      installDir: '/project',
      credentials,
      binding,
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
    await runProgram('metrics', {
      installDir: '/project',
      credentials,
      run: { ...run, skillId: 'metrics-skill' },
      binding,
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
      outcome: RunOutcome.Failed,
      failure: { message: 'Unknown program: missing-program' },
      settledRuns: [],
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('resolves a dynamic program from explicit input without a TUI session', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'events-audit',
      strategy: 'resolved',
      resolve: resolveEventsAuditRunDefinition,
    });

    const result = await runProgram('events-audit', {
      installDir: '/project',
      credentials,
      typescript: true,
    });

    expect(result.outcome).toBe(RunOutcome.Success);
    const [config] = vi.mocked(runAgent).mock.calls[0];
    expect(config.run.reportFile).toBe('posthog-events-audit-report.md');
    expect(config.run.customPrompt).toBeTypeOf('function');
    expect(result.artifacts.reportFile).toBe(
      '/project/posthog-events-audit-report.md',
    );
  });

  const check = (id: string, status: AuditCheck['status']): AuditCheck => ({
    id,
    area: 'Events',
    label: id,
    status,
  });

  it.each<
    [
      string,
      Pick<RuntimeProgramConfig, 'auditLedgerFile' | 'auditSeedChecks'>,
      Pick<ProgramInput, 'auditLedgerFile'>,
    ]
  >([
    [
      'its own seeded ledger',
      {
        auditLedgerFile: AUDIT_CHECKS_FILE,
        auditSeedChecks: [check('seed', 'pending')],
      },
      {},
    ],
    [
      'a ledger the host lays over it',
      {},
      { auditLedgerFile: AUDIT_CHECKS_FILE },
    ],
  ])(
    'observes %s for this run only, then releases the watcher',
    async (_ledger, config, input) => {
      const installDir = tempDir();
      const ledgerFile = path.join(installDir, AUDIT_CHECKS_FILE);
      const stale = [check('old', 'pending')];
      const updated = [check('seed', 'pass')];
      fs.writeFileSync(ledgerFile, JSON.stringify(stale));
      vi.mocked(getRuntimeProgramConfig).mockReturnValue({
        id: 'audit',
        strategy: 'static',
        run,
        ...config,
      });
      const originalWatch = auditWatcher.watchAuditLedger;
      const stop = vi.fn();
      const watch = vi
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
        const before: unknown = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
        expect(before).toEqual(config.auditSeedChecks ?? stale);
        fs.writeFileSync(ledgerFile, JSON.stringify(updated));
        return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
      });

      const result = await runProgram('audit', {
        installDir,
        credentials,
        ...input,
      });

      expect(result.data.detection.frameworkContext.auditChecks).toEqual(
        updated,
      );
      expect(watch).toHaveBeenCalledExactlyOnceWith(
        installDir,
        AUDIT_CHECKS_FILE,
        expect.any(Function),
      );
      expect(stop).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the event plan this run wrote, and releases its watcher when the agent throws', async () => {
    const installDir = tempDir();
    const planFile = path.join(installDir, EVENT_PLAN_FILE);
    fs.writeFileSync(planFile, JSON.stringify([{ event_name: 'stale' }]));
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'posthog-integration',
      strategy: 'integration',
      eventPlanFile: EVENT_PLAN_FILE,
    });
    const stop = vi.spyOn(ProgramEventPlanWatcher.prototype, 'stop');
    vi.mocked(runAgent)
      .mockImplementationOnce(() => {
        fs.writeFileSync(
          planFile,
          JSON.stringify([
            { event_name: 'checkout_started', description: 'A' },
          ]),
        );
        return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
      })
      .mockRejectedValueOnce(new Error('agent crashed'));
    const input = { installDir, credentials, run };

    const result = await runProgram('posthog-integration', input);
    await expect(runProgram('posthog-integration', input)).rejects.toThrow(
      'agent crashed',
    );

    expect(result.data.eventPlan).toEqual([
      { name: 'checkout_started', description: 'A' },
    ]);
    // The capture stops its own watch and settlement stops it again; the throw stops the second.
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it('hands a no-agent program to the host workflow, and fails without one', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'slack',
      strategy: 'no-agent',
    });
    const noAgentWorkflow = vi.fn().mockResolvedValue({
      outcome: RunOutcome.Success,
      data: { connected: true },
    });

    expect(await runProgram('slack', { installDir: '/project' })).toMatchObject(
      {
        outcome: RunOutcome.Failed,
        failure: { code: ErrorCodes.CliInteractiveRequired },
      },
    );
    expect(
      await runProgram(
        'slack',
        { installDir: '/project' },
        { noAgentWorkflow },
      ),
    ).toMatchObject({
      outcome: RunOutcome.Success,
      programData: { connected: true },
    });
    expect(noAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ programId: 'slack', installDir: '/project' }),
    );
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('aborts a no-agent workflow when the host cancels during the callback', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'mcp-tutorial',
      strategy: 'no-agent',
    });
    const controller = new AbortController();
    // The workflow still answers after the abort; the abort wins.
    const noAgentWorkflow = vi.fn(
      () =>
        new Promise<{ outcome: RunOutcome.Success }>((resolve) => {
          controller.signal.addEventListener('abort', () =>
            resolve({ outcome: RunOutcome.Success }),
          );
        }),
    );

    const pending = runProgram(
      'mcp-tutorial',
      { installDir: '/project' },
      { noAgentWorkflow, signal: controller.signal },
    );
    await vi.waitFor(() =>
      expect(noAgentWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ signal: controller.signal }),
      ),
    );
    controller.abort();

    expect(await pending).toMatchObject({
      outcome: RunOutcome.Aborted,
      failure: { code: ErrorCodes.AgentAbort },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('overrides reach the binding and the decision is captured once', async () => {
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
    const resolved = vi.mocked(runAgent).mock.calls[0][0].binding;
    expect(resolved).toMatchObject({
      sequence: Sequence.linear,
      harness: Harness.anthropic,
    });
    expect(captureSwitchboardDecision).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        program: 'metrics',
        cliHarness: Harness.anthropic,
        cliSequence: Sequence.linear,
      }),
      resolved,
    );
    expect(setTag.mock.calls).toEqual([
      ['sequence', Sequence.linear],
      ['harness', Harness.anthropic],
    ]);
    expect(observed).toContainEqual({
      kind: 'program',
      data: expect.objectContaining({ binding: resolved }),
    });
    expect(result.data.binding).toEqual(resolved);
  });

  it('uses a host-resolved binding without capturing the decision again', async () => {
    const result = await runProgram('metrics', {
      installDir: '/project',
      credentials,
      binding,
      overrides: { harness: Harness.pi },
    });

    expect(vi.mocked(runAgent).mock.calls[0][0].binding).toEqual(binding);
    expect(captureSwitchboardDecision).not.toHaveBeenCalled();
    expect(analytics.setTag).not.toHaveBeenCalled();
    expect(result.data.binding).toEqual(binding);
  });

  it('runs in order: agent started, credentials, approval, post-auth, flags, refresh, route, agent', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'metrics',
      strategy: 'static',
      run,
      postAuthGates: ['detect'],
    });
    const order: string[] = [];
    const answer = <T>(name: string, value: T) =>
      vi.fn(() => {
        order.push(name);
        return Promise.resolve(value);
      });
    vi.mocked(analytics.wizardCapture).mockImplementationOnce((event) => {
      order.push(event);
    });
    vi.mocked(analytics.setTag).mockImplementationOnce(() => {
      order.push('route');
    });
    vi.mocked(refreshAccessToken).mockImplementationOnce(
      answer('refresh', refreshedToken),
    );
    vi.mocked(runAgent).mockImplementationOnce(
      answer('runAgent', { outcome: RunOutcome.Success, snapshot }),
    );
    const flags = {
      flags: { 'wizard-test-flag': 'on' },
      payloads: { 'wizard-test-flag': { variant: 'b' } },
    };

    const result = await runProgram(
      'metrics',
      {
        installDir: '/project',
        run: { ...run, integrationLabel: 'custom-label', skillId: 'skill-x' },
      },
      {
        credentials: {
          resolve: answer('credentials', {
            ...credentials,
            posthog: aging(),
            apiUser: null,
          }),
        },
        awaitAiApproval: answer('approval', true),
        workflow: { step: answer('post-auth', { kind: 'post-auth' as const }) },
        featureFlags: answer('flags', flags),
      },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(order).toEqual([
      'agent started',
      'credentials',
      'approval',
      'post-auth',
      'flags',
      'refresh',
      'route',
      'runAgent',
    ]);
    expect(analytics.wizardCapture).toHaveBeenCalledWith('agent started', {
      integration: 'custom-label',
      program_id: 'metrics',
      skill_id: 'skill-x',
    });
    expect(vi.mocked(runAgent).mock.calls[0][0]).toMatchObject({
      wizardFlags: flags.flags,
      wizardFlagPayloads: flags.payloads,
    });
  });

  it('prefers the input flags over the loader', async () => {
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

  it.each<[string, number, () => [string, ProgramOptions]]>([
    [
      'the flag loader',
      0,
      () => [
        'metrics',
        { featureFlags: () => Promise.reject(new Error('host closed')) },
      ],
    ],
    [
      'credential resolution',
      0,
      () => [
        'metrics',
        {
          credentials: {
            resolve: () => Promise.reject(new Error('host closed')),
          },
        },
      ],
    ],
    [
      'a composition gate',
      1,
      () => {
        composeSelfDriving();
        const step = vi
          .fn()
          .mockResolvedValueOnce({ kind: 'child-run', input: child() })
          .mockRejectedValue(new Error('host closed'));
        return ['self-driving', { workflow: { step } }];
      },
    ],
  ])(
    'a rejection from %s is a decided failure before the agent it guards',
    async (_capability, agentRuns, setup) => {
      const [programId, options] = setup();

      const result = await runProgram(
        programId,
        { installDir: '/project' },
        {
          credentials: { resolve: () => Promise.resolve(credentials) },
          ...options,
        },
      );

      expect(result).toMatchObject({
        outcome: RunOutcome.Failed,
        failure: { message: 'host closed' },
      });
      expect(result.artifacts.reportFile).toBeUndefined();
      expect(result.settledRuns).toHaveLength(agentRuns);
      expect(runAgent).toHaveBeenCalledTimes(agentRuns);
    },
  );

  it('blocks an AI program before agent start without org approval or a host approval capability', async () => {
    const result = await runProgram('metrics', {
      installDir: '/project',
      credentials: { ...credentials, apiUser: null },
    });

    expect(result).toMatchObject({
      outcome: RunOutcome.Failed,
      failure: { message: expect.stringContaining('AI') },
    });
    expect(runAgent).not.toHaveBeenCalled();
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
    expect(awaitAiApproval).toHaveBeenCalledOnce();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('passes the invocation signal to the provider and to the AI approval wait', async () => {
    const controller = new AbortController();
    const resolve = vi
      .fn()
      .mockResolvedValue({ ...credentials, apiUser: null });
    const awaitAiApproval = vi.fn().mockResolvedValue(true);

    const result = await runProgram(
      'metrics',
      { installDir: '/project' },
      { credentials: { resolve }, awaitAiApproval, signal: controller.signal },
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

  it.each<
    [
      string,
      readonly string[],
      Partial<ProgramInput>,
      (park: () => Promise<never>) => ProgramOptions,
    ]
  >([
    [
      'credential resolution',
      [],
      {},
      (park) => ({ credentials: { resolve: park } }),
    ],
    [
      'AI approval',
      [],
      { credentials: { ...credentials, apiUser: null } },
      (park) => ({ awaitAiApproval: park }),
    ],
    [
      'a post-auth gate',
      ['detect'],
      { credentials },
      (park) => ({ workflow: { step: park } }),
    ],
  ])(
    'a host abort during %s returns Aborted and starts nothing else',
    async (_park, postAuthGates, input, options) => {
      vi.mocked(getRuntimeProgramConfig).mockReturnValue({
        id: 'metrics',
        strategy: 'static',
        run,
        postAuthGates,
      });
      const controller = new AbortController();
      // The host closes its screen on abort, so the pending capability rejects.
      const park = vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener('abort', () =>
              reject(new Error('screen closed')),
            );
          }),
      );

      const pending = runProgram(
        'metrics',
        { installDir: '/project', ...input },
        { ...options(park), signal: controller.signal },
      );
      await vi.waitFor(() => expect(park).toHaveBeenCalledOnce());
      controller.abort();

      expect(await pending).toMatchObject({
        outcome: RunOutcome.Aborted,
        failure: {
          code: ErrorCodes.AgentAbort,
          message: 'Run cancelled by host.',
        },
      });
      expect(runAgent).not.toHaveBeenCalled();
    },
  );

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

  it.each([
    [
      'handoff',
      { githubConnected: true },
      'Self-driving handoff was not confirmed.',
    ],
    [
      'GitHub connection',
      { handoffConfirmed: true },
      'GitHub connection was not confirmed.',
    ],
  ])(
    'aborts before self-driving starts when the prepared %s is not confirmed',
    async (_gate, gates, message) => {
      composeSelfDriving();

      const result = await runProgram('self-driving', {
        installDir: '/project',
        credentials,
        composition: { integration: child(), ...gates },
      });

      expect(result).toMatchObject({
        outcome: RunOutcome.Aborted,
        failure: { message },
      });
      expect(
        vi.mocked(runAgent).mock.calls.map(([config]) => config.programId),
      ).toEqual(['posthog-integration']);
    },
  );

  it('the outro reads the notebook URL emitted during the run', async () => {
    vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
      id: 'posthog-integration',
      strategy: 'integration',
    });
    let outro: OutroData | undefined;
    vi.mocked(runAgent).mockImplementation((config, input, options) => {
      options?.onProgress?.({
        kind: 'url',
        which: 'notebook',
        url: 'https://us.posthog.com/notebook/7',
      });
      outro = config.hooks?.buildOutroData?.(input.credentials);
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    const result = await runProgram(
      'posthog-integration',
      {
        installDir: '/project',
        credentials,
        frameworkConfig: integrationFrameworkConfig(),
        flags: { ci: true },
      },
      { integrationEffects: integrationEffects() },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(outro).toMatchObject({
      notebookUrl: 'https://us.posthog.com/notebook/7',
      handoffPrompt: expect.stringContaining(
        'https://us.posthog.com/notebook/7',
      ),
    });
  });

  it.each([
    ['the lazy entry', runProgram],
    ['run-program', runProgramDirect],
  ])(
    'a host mutation after the call does not reach run resolution, through %s',
    async (_entry, callProgram) => {
      vi.mocked(getRuntimeProgramConfig).mockReturnValueOnce({
        id: 'posthog-integration',
        strategy: 'integration',
      });
      let prompt: string | undefined;
      let seeded: SeedTaskEntry[] | undefined;
      let outro: OutroData | undefined;
      let nextSteps: { heading: string; items: string[] } | undefined;
      vi.mocked(runAgent).mockImplementation((config, input) => {
        prompt = config.run.customPrompt?.(credentials.posthog);
        seeded = config.seedTasks?.();
        outro = config.hooks?.buildOutroData?.(input.credentials);
        nextSteps = config.hooks?.buildOutroNextSteps?.(input.credentials, []);
        return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
      });
      const frameworkContext = { router: 'app' };
      const warehouseSources = [warehouseSource('Stripe')];
      const flags = { ci: false };
      const host: NonNullable<ProgramInput['host']> = { region: 'us' };

      const pending = callProgram(
        'posthog-integration',
        {
          installDir: '/project',
          frameworkConfig: integrationFrameworkConfig(),
          frameworkContext,
          warehouseSources,
          flags,
          host,
        },
        {
          credentials: { resolve: () => Promise.resolve(credentials) },
          integrationEffects: integrationEffects(),
        },
      );
      frameworkContext.router = 'pages';
      warehouseSources.push(warehouseSource('Postgres'));
      flags.ci = true;
      host.region = 'eu';
      const result = await pending;

      expect(result.outcome).toBe(RunOutcome.Success);
      expect(prompt).toContain('Router: app');
      expect(outro?.changes).toEqual(['Configured the app router']);
      expect(seeded).toMatchObject([
        { type: 'warehouse', inputs: { sources: [{ kind: 'Stripe' }] } },
      ]);
      expect(nextSteps?.items[0]).toContain('Connect Stripe');
      expect(nextSteps?.items.join('\n')).not.toContain('Postgres');
      const [, runInput] = vi.mocked(runAgent).mock.calls[0];
      expect(runInput.flags.ci).toBe(false);
      expect(runInput.host.region).toBe('us');
      expect(result.data.detection.frameworkContext).toEqual({ router: 'app' });
    },
  );

  it('copies a composed child’s input when the connector hands it over', async () => {
    composeSelfDriving();
    const childContext = { router: 'app' };
    const prompts: string[] = [];
    vi.mocked(runAgent).mockImplementation((config) => {
      // The host keeps writing the object it handed over.
      childContext.router = 'pages';
      if (config.programId === 'posthog-integration') {
        prompts.push(config.run.customPrompt?.(credentials.posthog) ?? '');
      }
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const workflow = connector({
      installDir: '/project/app',
      frameworkConfig: integrationFrameworkConfig(),
      frameworkContext: childContext,
    });

    const result = await runProgram(
      'self-driving',
      { installDir: '/project', credentials },
      { workflow, integrationEffects: integrationEffects() },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(prompts).toEqual([expect.stringContaining('Router: app')]);
  });

  it('composes an integration run before self-driving with one attributed ledger', async () => {
    composeSelfDriving();
    vi.mocked(runAgent).mockImplementation((config, _input, options) => {
      options?.onProgress?.({ kind: 'status', message: config.programId });
      return Promise.resolve({
        outcome: RunOutcome.Success,
        skillId: config.programId,
        snapshot,
      });
    });
    const featureFlags = vi
      .fn()
      .mockResolvedValue({ flags: { 'wizard-test-flag': 'on' }, payloads: {} });
    const observed: ProgramProgress[] = [];

    const result = await runProgram(
      'self-driving',
      {
        installDir: '/project',
        runId: 'parent',
        credentials,
        overrides: { harness: Harness.anthropic },
        composition: {
          integration: child(),
          handoffConfirmed: true,
          githubConnected: true,
        },
      },
      { featureFlags, onProgress: (event) => observed.push(event) },
    );

    expect(featureFlags).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(runAgent)
        .mock.calls.map(([config, input]) => [
          config.programId,
          config.composed,
          input.installDir,
          config.binding.harness,
          config.wizardFlags,
        ]),
    ).toEqual([
      [
        'posthog-integration',
        true,
        '/project/app',
        Harness.anthropic,
        { 'wizard-test-flag': 'on' },
      ],
      [
        'self-driving',
        false,
        '/project',
        Harness.anthropic,
        { 'wizard-test-flag': 'on' },
      ],
    ]);
    expect(
      observed.filter((progress) => progress.kind === 'run'),
    ).toMatchObject([
      { kind: 'run', runId: 'parent:integrate-run', stepId: 'integrate-run' },
      { kind: 'run', runId: 'parent' },
    ]);
    expect(
      observed.filter((progress) => progress.kind === 'program').at(-1),
    ).toEqual({ kind: 'program', data: result.data });
    expect(
      result.settledRuns.map(({ runId, result }) => [runId, result.skillId]),
    ).toEqual([
      ['parent:integrate-run', 'posthog-integration'],
      ['parent', 'self-driving'],
    ]);
    expect(result.data.composition.completedRuns).toContain('integrate-run');
  });

  it('a provider is resolved once, then stamped, and refreshed before the agent starts', async () => {
    composeSelfDriving();
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(refreshedToken);
    const apiUser = {
      distinct_id: 'user-1',
      organization: { id: 'org-1', is_ai_data_processing_approved: true },
    } as ApiUser;
    const resolve = vi
      .fn()
      .mockResolvedValue({ posthog: aging(), project: null, apiUser });

    const result = await runProgram(
      'self-driving',
      {
        installDir: '/project',
        host: { baseUrl: 'https://posthog.example' },
        mayReportScanResults: true,
        discoveredFeatures: [DiscoveredFeature.LLM],
        composition: {
          integration: child(),
          handoffConfirmed: true,
          githubConnected: true,
        },
      },
      { credentials: { resolve } },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(resolve).toHaveBeenCalledOnce();
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
        .mock.calls.map(([, input]) => input.credentials.accessToken),
    ).toEqual(['pha_refreshed', 'pha_refreshed']);
    expect(result.data).toMatchObject({
      credentials: {
        accessToken: 'pha_refreshed',
        refreshToken: 'phr_rotated',
      },
      aiSdkStampReported: true,
    });

    await vi.mocked(runAgent).mock.calls[1][1].inferenceAuth.resolve();
    expect(gatewayAuth).toHaveBeenCalledExactlyOnceWith(
      credentials.posthog.host,
      'pha_refreshed',
      'self-driving',
    );
  });

  it('leaves a stamp the host already reported and a fresh token alone', async () => {
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
    expect(vi.mocked(runAgent).mock.calls[0][1].credentials).toEqual(
      fresh.posthog,
    );
    expect(result.data.aiSdkStampReported).toBe(true);
  });

  it('stops the composed run when the child fails', async () => {
    composeSelfDriving();
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
      composition: { integration: child() },
    });

    expect(result).toMatchObject({
      programId: 'self-driving',
      outcome: RunOutcome.Failed,
      failure: { message: 'integration failed' },
      settledRuns: [{ stepId: 'integrate-run' }],
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('a fixture connector composes self-driving without the TUI', async () => {
    composeSelfDriving();
    const workflow = connector(child());

    const result = await runProgram(
      'self-driving',
      { installDir: '/project', runId: 'parent', credentials },
      { workflow },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(workflow.step.mock.calls.map(([request]) => request)).toEqual([
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
    composeSelfDriving();
    const { step } = connector(null);

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
    const resolve = vi.fn(() => run);
    vi.mocked(getRuntimeProgramConfig).mockReturnValue({
      id: 'error-tracking-upload-source-maps',
      strategy: 'resolved',
      resolve,
      postAuthGates: ['detect'],
    });
    const step = vi.fn(
      (): Promise<ProgramWorkflowDecision> =>
        Promise.resolve({
          kind: 'post-auth',
          frameworkContext: { selectedProject: 'apps/web' },
        }),
    );

    const result = await runProgram(
      'error-tracking-upload-source-maps',
      {
        installDir: '/project',
        credentials,
        frameworkContext: { detected: true },
      },
      { workflow: { step } },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
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

  it('cleans a child skill if a later composition gate aborts', async () => {
    const installDir = tempDir();
    const childDir = path.join(installDir, 'app');
    const skillRoot = path.join(childDir, '.claude', 'skills');
    const oldSkill = path.join(skillRoot, 'before-run');
    const newSkill = path.join(skillRoot, 'during-run');
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.writeFileSync(path.join(oldSkill, '.posthog-wizard'), '');
    composeSelfDriving();
    vi.mocked(runAgent).mockImplementation(() => {
      fs.mkdirSync(newSkill);
      fs.writeFileSync(path.join(newSkill, '.posthog-wizard'), '');
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const step = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'child-run',
        input: { ...child(), installDir: childDir },
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
  });

  describe('skill cleanup', () => {
    let installDir: string;
    let newSkill: string;
    let oldSkill: string;
    const markSkill = (dir: string) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
    };

    beforeEach(() => {
      clearCleanup();
      installDir = tempDir();
      const skillRoot = path.join(installDir, '.claude', 'skills');
      oldSkill = path.join(skillRoot, 'before-run');
      newSkill = path.join(skillRoot, 'during-run');
      markSkill(oldSkill);
      vi.mocked(runAgent).mockImplementation(() => {
        markSkill(newSkill);
        return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
      });
    });
    afterEach(() => clearCleanup());

    it("a process drain mid-run removes this invocation's new skills", async () => {
      vi.mocked(runAgent).mockImplementation(() => {
        markSkill(newSkill);
        // What wizardAbort and the CLI roots' signal handlers call.
        runCleanups();
        return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
      });

      await runProgram('metrics', { installDir, credentials });

      expect(fs.existsSync(newSkill)).toBe(false);
      expect(fs.existsSync(oldSkill)).toBe(true);
    });

    it('deferSkillCommit keeps the handle until the host commits', async () => {
      await runProgram(
        'metrics',
        { installDir, credentials },
        { deferSkillCommit: true },
      );
      // A host that fails after the run still drains this invocation's skills.
      runCleanups();
      expect(fs.existsSync(newSkill)).toBe(false);

      await runProgram(
        'metrics',
        { installDir, credentials },
        { deferSkillCommit: true },
      );
      commitRegisteredRunSkillCleanups();
      runCleanups();
      expect(fs.existsSync(newSkill)).toBe(true);
      expect(fs.existsSync(oldSkill)).toBe(true);
    });

    it('commits its own handles after a successful run', async () => {
      await runProgram('metrics', { installDir, credentials });
      runCleanups();

      expect(fs.existsSync(newSkill)).toBe(true);
    });
  });
});
