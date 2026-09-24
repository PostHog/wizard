import { runAgent, RunOutcome } from '@agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EVENT_PLAN_FILE, Harness, Sequence } from '@shared/constants';
import { AUDIT_CHECKS_FILE } from '@shared/audit-ledger';
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

/** The programs these tests call; self-driving composes one integration child. */
const PROGRAMS: Record<string, RuntimeProgramConfig> = {
  metrics: { id: 'metrics', strategy: 'static', run },
  gated: { id: 'gated', strategy: 'static', run, postAuthGates: ['detect'] },
  slack: { id: 'slack', strategy: 'no-agent' },
  'posthog-integration': { id: 'posthog-integration', strategy: 'integration' },
  'self-driving': {
    id: 'self-driving',
    strategy: 'self-driving',
    composedRuns: [
      { stepId: 'integrate-run', runProgramId: 'posthog-integration' },
    ],
  },
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

const login = (apiUser: ApiUser | null = credentials.apiUser) => ({
  resolve: () => Promise.resolve({ ...credentials, apiUser }),
});

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

/** A framework whose prompt reads the framework context. */
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
    ui: { successMessage: 'Done', getOutroChanges: () => [] },
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

const markSkill = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
};

describe('runProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeProgramConfig).mockImplementation((id) => PROGRAMS[id]);
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

  it('calls a static program with explicit inputs and returns its final results', async () => {
    const outcome = await runProgram('metrics', {
      installDir: '/project',
      runId: 'run-1',
      credentials,
    });

    const [config, input] = vi.mocked(runAgent).mock.calls[0];
    expect(config.run).toBe(run);
    expect(input.installDir).toBe('/project');
    expect(input.credentials).toBe(credentials.posthog);
    expect(input.inferenceAuth).toBe(credentials.inferenceAuth);
    expect(outcome).toMatchObject({
      programId: 'metrics',
      outcome: RunOutcome.Success,
      data: { credentials: { projectId: 42 } },
      settledRuns: [
        { runId: 'run-1', result: { outcome: RunOutcome.Success } },
      ],
      diagnostics: [],
      artifacts: { reportFile: '/project/posthog-metrics-report.md' },
    });
  });

  it('every run carries the standard trace tags, which input metadata overrides but cannot reroute', async () => {
    await runProgram('metrics', {
      installDir: '/project',
      credentials,
      binding,
      wizardMetadata: { call_type: 'detection', SEQUENCE: 'not-the-route' },
    });

    expect(vi.mocked(runAgent).mock.calls[0][0].wizardMetadata).toEqual({
      program_id: 'metrics',
      integration: 'metrics',
      run_id: 'analytics-run-id',
      build: 'test',
      call_type: 'detection',
      SEQUENCE: Sequence.linear,
      HARNESS: Harness.anthropic,
    });
  });

  const closed = () => Promise.reject(new Error('host closed'));
  it.each<[string, string, () => ProgramOptions, RunOutcome, string, number]>([
    [
      'an unknown program',
      'missing-program',
      () => ({ credentials: login() }),
      RunOutcome.Failed,
      'Unknown program: missing-program',
      0,
    ],
    [
      'no org AI approval and no host approval capability',
      'metrics',
      () => ({ credentials: login(null) }),
      RunOutcome.Failed,
      'AI processing approval is required before this program can run.',
      0,
    ],
    [
      'a declined host AI approval',
      'metrics',
      () => ({
        credentials: login(null),
        awaitAiApproval: () => Promise.resolve(false),
      }),
      RunOutcome.Aborted,
      'AI processing approval declined.',
      0,
    ],
    [
      'a connector answer of the wrong kind',
      'gated',
      () => ({
        credentials: login(),
        workflow: {
          step: () => Promise.resolve({ kind: 'confirm', confirmed: true }),
        },
      }),
      RunOutcome.Failed,
      'Workflow connector answered confirm to a post-auth request',
      0,
    ],
    [
      'a rejecting credential provider',
      'metrics',
      () => ({ credentials: { resolve: closed } }),
      RunOutcome.Failed,
      'host closed',
      0,
    ],
    [
      'a rejecting composition gate',
      'self-driving',
      () => ({
        credentials: login(),
        workflow: {
          step: vi
            .fn()
            .mockResolvedValueOnce({ kind: 'child-run', input: child() })
            .mockImplementation(closed),
        },
      }),
      RunOutcome.Failed,
      'host closed',
      1,
    ],
  ])(
    '%s is a decided result before the agent it guards',
    async (_case, programId, options, outcome, message, agentRuns) => {
      const result = await runProgram(
        programId,
        { installDir: '/project' },
        options(),
      );

      expect(result).toMatchObject({ outcome, failure: { message } });
      expect(result.settledRuns).toHaveLength(agentRuns);
      expect(runAgent).toHaveBeenCalledTimes(agentRuns);
    },
  );

  it.each([
    'credential resolution',
    'AI approval',
    'a post-auth gate',
  ] as const)(
    'a host abort during %s reaches the capability, returns Aborted and starts nothing else',
    async (gate) => {
      const controller = new AbortController();
      // Each capability takes the invocation signal last and rejects when it aborts.
      const park = vi.fn(
        (...args: unknown[]) =>
          new Promise<never>((_resolve, reject) => {
            const { signal } = args.at(-1) as { signal: AbortSignal };
            signal.addEventListener('abort', () =>
              reject(new Error('screen closed')),
            );
          }),
      );
      const options: ProgramOptions = {
        'credential resolution': { credentials: { resolve: park } },
        'AI approval': { credentials: login(null), awaitAiApproval: park },
        'a post-auth gate': { credentials: login(), workflow: { step: park } },
      }[gate];

      const pending = runProgram(
        'gated',
        { installDir: '/project' },
        { ...options, signal: controller.signal },
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
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('forwards the host signal to the agent', async () => {
    const { signal } = new AbortController();

    await runProgram(
      'metrics',
      { installDir: '/project', credentials },
      { signal },
    );

    expect(vi.mocked(runAgent).mock.calls[0][2]?.signal).toBe(signal);
  });

  it('hands a no-agent program to the host workflow, and fails without one', async () => {
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
      'slack',
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
    const result = await runProgram('metrics', {
      installDir: '/project',
      credentials,
      overrides: { harness: Harness.anthropic, sequence: Sequence.linear },
    });

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
    expect(analytics.setTag).toHaveBeenCalledWith('harness', Harness.anthropic);
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
      'gated',
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
      program_id: 'gated',
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

    await runProgram(
      'posthog-integration',
      {
        installDir: '/project',
        credentials,
        frameworkConfig: integrationFrameworkConfig(),
        flags: { ci: true },
      },
      { integrationEffects: integrationEffects() },
    );

    expect(outro?.notebookUrl).toBe('https://us.posthog.com/notebook/7');
  });

  it.each([
    ['the lazy entry', runProgram],
    ['run-program', runProgramDirect],
  ])(
    'a host mutation after the call does not reach run resolution, through %s',
    async (_entry, callProgram) => {
      let prompt: string | undefined;
      let seeded: SeedTaskEntry[] | undefined;
      vi.mocked(runAgent).mockImplementation((config) => {
        prompt = config.run.customPrompt?.(credentials.posthog);
        seeded = config.seedTasks?.();
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
        { credentials: login(), integrationEffects: integrationEffects() },
      );
      frameworkContext.router = 'pages';
      warehouseSources.push(warehouseSource('Postgres'));
      flags.ci = true;
      host.region = 'eu';
      await pending;

      expect(prompt).toContain('Router: app');
      expect(seeded).toMatchObject([
        { type: 'warehouse', inputs: { sources: [{ kind: 'Stripe' }] } },
      ]);
      const [, runInput] = vi.mocked(runAgent).mock.calls[0];
      expect(runInput.flags.ci).toBe(false);
      expect(runInput.host.region).toBe('us');
    },
  );

  it('copies a composed child’s input when the connector hands it over', async () => {
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

    await runProgram(
      'self-driving',
      { installDir: '/project', credentials },
      { workflow, integrationEffects: integrationEffects() },
    );

    expect(prompts).toEqual([expect.stringContaining('Router: app')]);
  });

  it('composes an integration run before self-driving with one attributed ledger', async () => {
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

    const shared = {
      binding: { harness: Harness.anthropic },
      wizardFlags: { 'wizard-test-flag': 'on' },
    };
    expect(vi.mocked(runAgent).mock.calls).toMatchObject([
      [
        { ...shared, programId: 'posthog-integration', composed: true },
        { installDir: '/project/app' },
        expect.anything(),
      ],
      [
        { ...shared, programId: 'self-driving', composed: false },
        { installDir: '/project' },
        expect.anything(),
      ],
    ]);
    expect(
      observed.filter((progress) => progress.kind === 'run'),
    ).toMatchObject([
      { kind: 'run', runId: 'parent:integrate-run', stepId: 'integrate-run' },
      { kind: 'run', runId: 'parent' },
    ]);
    expect(
      result.settledRuns.map(({ runId, result }) => [runId, result.skillId]),
    ).toEqual([
      ['parent:integrate-run', 'posthog-integration'],
      ['parent', 'self-driving'],
    ]);
    expect(result.data.composition.completedRuns).toContain('integrate-run');
  });

  it('asks a connector for the child and each confirmation in turn', async () => {
    const workflow = connector(child());

    const result = await runProgram(
      'self-driving',
      { installDir: '/project', credentials },
      { workflow },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    const base = { programId: 'self-driving', installDir: '/project' };
    expect(workflow.step.mock.calls.map(([request]) => request)).toEqual([
      {
        ...base,
        kind: 'child-run',
        stepId: 'integrate-run',
        runProgramId: 'posthog-integration',
      },
      { ...base, kind: 'confirm', id: 'self-driving-handoff' },
      { ...base, kind: 'confirm', id: 'self-driving-github' },
    ]);
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it('skips the child and its handoff when the host ran the child itself', async () => {
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

  it('stops the composed run when the child fails', async () => {
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
      data: { composition: { completedRuns: [] } },
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('a provider is resolved once, then stamped, and refreshed before the agent starts', async () => {
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
    // The child refreshed the login, so the parent starts on the same token.
    expect(
      vi
        .mocked(runAgent)
        .mock.calls.map(([, input]) => input.credentials.accessToken),
    ).toEqual(['pha_refreshed', 'pha_refreshed']);
    expect(result.data.credentials?.refreshToken).toBe('phr_rotated');

    await vi.mocked(runAgent).mock.calls[1][1].inferenceAuth.resolve();
    expect(gatewayAuth).toHaveBeenCalledExactlyOnceWith(
      credentials.posthog.host,
      'pha_refreshed',
      'self-driving',
    );
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

  it('observes a ledger the host lays over a program for this run', async () => {
    const installDir = tempDir();
    const ledgerFile = path.join(installDir, AUDIT_CHECKS_FILE);
    const updated = [
      { id: 'seed', area: 'Events', label: 'seed', status: 'pass' },
    ];
    const watch = vi.spyOn(auditWatcher, 'watchAuditLedger');
    vi.mocked(runAgent).mockImplementation(() => {
      fs.writeFileSync(ledgerFile, JSON.stringify(updated));
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    const result = await runProgram('metrics', {
      installDir,
      credentials,
      auditLedgerFile: AUDIT_CHECKS_FILE,
    });

    expect(result.data.detection.frameworkContext.auditChecks).toEqual(updated);
    expect(watch).toHaveBeenCalledExactlyOnceWith(
      installDir,
      AUDIT_CHECKS_FILE,
      expect.any(Function),
    );
  });

  it('returns the event plan this run wrote, and releases its watcher when the agent throws', async () => {
    const installDir = tempDir();
    const planFile = path.join(installDir, EVENT_PLAN_FILE);
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
    stop.mockClear();
    await expect(runProgram('posthog-integration', input)).rejects.toThrow(
      'agent crashed',
    );

    expect(result.data.eventPlan).toEqual([
      { name: 'checkout_started', description: 'A' },
    ]);
    expect(stop).toHaveBeenCalledOnce();
  });

  describe('skill cleanup', () => {
    let installDir: string;
    let newSkill: string;
    let oldSkill: string;

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

    it('cleans a child skill if a later composition gate aborts', async () => {
      const childDir = path.join(installDir, 'app');
      const childOld = path.join(childDir, '.claude', 'skills', 'before-run');
      const childNew = path.join(childDir, '.claude', 'skills', 'during-run');
      markSkill(childOld);
      vi.mocked(runAgent).mockImplementation(() => {
        markSkill(childNew);
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
      expect(fs.existsSync(childNew)).toBe(false);
      expect(fs.existsSync(childOld)).toBe(true);
      expect(runAgent).toHaveBeenCalledTimes(1);
    });

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
