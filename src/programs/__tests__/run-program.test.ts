import { runAgent, RunOutcome } from '@agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EVENT_PLAN_FILE, Harness, Sequence } from '@shared/constants';
import { AUDIT_CHECKS_FILE, type AuditCheck } from '@shared/audit-ledger';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import type { DetectedSource } from '../warehouse-sources/types';
import type { ResolvedProgramCredentials } from '../credentials';
import type { ProgramInput, ProgramOptions } from '../run-program';
import { ErrorCodes } from '@shared/errors';
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

/** A program with one post-auth gate, like the source-maps project picker. */
const gated: ProgramInput = {
  installDir: '/project',
  run,
  program: { postAuthGates: ['detect'] },
};

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

  it("runs the caller's run definition and program settings, and returns its final results", async () => {
    const excludedTaskTypes = () => ['logs'];
    const outcome = await runProgram('metrics', {
      installDir: '/project',
      runId: 'run-1',
      run,
      program: {
        agentFlow: 'metrics-flow',
        allowedTools: ['Agent'],
        disallowedTools: ['wizard_ask'],
        excludedTaskTypes,
      },
      credentials,
    });

    const [config, input] = vi.mocked(runAgent).mock.calls[0];
    expect(config).toMatchObject({
      programId: 'metrics',
      run,
      agentFlow: 'metrics-flow',
      allowedTools: ['Agent'],
      disallowedTools: ['wizard_ask'],
    });
    expect(config.excludedTaskTypes).toBe(excludedTaskTypes);
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

  it('every run carries the standard trace tags and its route', async () => {
    await runProgram('metrics', {
      installDir: '/project',
      run,
      credentials,
      overrides: { harness: Harness.anthropic, sequence: Sequence.linear },
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

  const closed = () => Promise.reject(new Error('host closed'));
  it.each<[string, () => ProgramOptions, RunOutcome, string]>([
    [
      'no credentials',
      () => ({}),
      RunOutcome.Failed,
      'Credentials are required to run metrics.',
    ],
    [
      'no org AI approval and no host approval capability',
      () => ({ credentials: login(null) }),
      RunOutcome.Failed,
      'AI processing approval is required before this program can run.',
    ],
    [
      'a declined host AI approval',
      () => ({
        credentials: login(null),
        awaitAiApproval: () => Promise.resolve(false),
      }),
      RunOutcome.Aborted,
      'AI processing approval declined.',
    ],
    [
      'a rejecting credential provider',
      () => ({ credentials: { resolve: closed } }),
      RunOutcome.Failed,
      'host closed',
    ],
  ])(
    '%s is a decided result before the agent it guards',
    async (_case, options, outcome, message) => {
      const result = await runProgram(
        'metrics',
        { installDir: '/project', run },
        options(),
      );

      expect(result).toMatchObject({ outcome, failure: { message } });
      expect(result.settledRuns).toHaveLength(0);
      expect(runAgent).not.toHaveBeenCalled();
    },
  );

  it('a program that needs no AI runs without an approval', async () => {
    const awaitAiApproval = vi.fn();

    const result = await runProgram(
      'metrics',
      { installDir: '/project', run, program: { requiresAi: false } },
      { credentials: login(null), awaitAiApproval },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(awaitAiApproval).not.toHaveBeenCalled();
  });

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
        'a post-auth gate': { credentials: login(), awaitPostAuthGates: park },
      }[gate];

      const pending = runProgram('gated', gated, {
        ...options,
        signal: controller.signal,
      });
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
      { installDir: '/project', run },
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
      { installDir: '/project', run, credentials },
      { signal },
    );

    expect(vi.mocked(runAgent).mock.calls[0][2]?.signal).toBe(signal);
  });

  it('overrides reach the binding and the decision is captured once', async () => {
    const result = await runProgram('metrics', {
      installDir: '/project',
      run,
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
    const awaitPostAuthGates = answer('post-auth', undefined);

    const result = await runProgram(
      'gated',
      {
        ...gated,
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
        awaitPostAuthGates,
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
    expect(awaitPostAuthGates).toHaveBeenCalledWith({
      programId: 'gated',
      gates: ['detect'],
      signal: expect.objectContaining({ aborted: false }),
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
        run,
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
    ['the lazy entry', runProgram],
    ['run-program', runProgramDirect],
  ])(
    'a host mutation after the call does not reach the run, through %s',
    async (_entry, callProgram) => {
      const flags = { ci: false };
      const host: NonNullable<ProgramInput['host']> = { region: 'us' };

      const pending = callProgram(
        'metrics',
        { installDir: '/project', run, flags, host },
        { credentials: login() },
      );
      flags.ci = true;
      host.region = 'eu';
      await pending;

      const [, runInput] = vi.mocked(runAgent).mock.calls[0];
      expect(runInput.flags.ci).toBe(false);
      expect(runInput.host.region).toBe('us');
    },
  );

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
      'metrics',
      {
        installDir: '/project',
        run,
        host: { baseUrl: 'https://posthog.example' },
        mayReportScanResults: true,
        discoveredFeatures: [DiscoveredFeature.LLM],
        warehouseSources: [warehouseSource('Stripe')],
      },
      { credentials: { resolve } },
    );

    expect(resolve).toHaveBeenCalledOnce();
    expect(analytics.identifyUser).toHaveBeenCalledExactlyOnceWith(apiUser);
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
    expect(vi.mocked(runAgent).mock.calls[0][1].credentials.accessToken).toBe(
      'pha_refreshed',
    );
    expect(result.data).toMatchObject({
      credentials: { refreshToken: 'phr_rotated' },
      aiSdkStampReported: true,
    });

    await vi.mocked(runAgent).mock.calls[0][1].inferenceAuth.resolve();
    expect(gatewayAuth).toHaveBeenCalledExactlyOnceWith(
      credentials.posthog.host,
      'pha_refreshed',
      'metrics',
    );
  });

  it('seeds the audit ledger before the agent and returns the checks this run wrote', async () => {
    const installDir = tempDir();
    const ledgerFile = path.join(installDir, AUDIT_CHECKS_FILE);
    const seed: AuditCheck[] = [
      { id: 'seed', area: 'Events', label: 'seed', status: 'pending' },
    ];
    const updated = [{ ...seed[0], status: 'pass' }];
    let seededBeforeRun: unknown;
    vi.mocked(runAgent).mockImplementation(() => {
      seededBeforeRun = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
      fs.writeFileSync(ledgerFile, JSON.stringify(updated));
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    const result = await runProgram('audit', {
      installDir,
      run,
      credentials,
      program: { auditLedgerFile: AUDIT_CHECKS_FILE, auditSeedChecks: seed },
    });

    expect(seededBeforeRun).toEqual(seed);
    expect(result.data.detection.frameworkContext.auditChecks).toEqual(updated);
  });

  it('returns the event plan this run wrote, and releases its watcher when the agent throws', async () => {
    const installDir = tempDir();
    const planFile = path.join(installDir, EVENT_PLAN_FILE);
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
    const input: ProgramInput = {
      installDir,
      credentials,
      run,
      program: { eventPlanFile: EVENT_PLAN_FILE },
    };

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

    it("a failed run removes this invocation's new skills", async () => {
      vi.mocked(runAgent).mockImplementation(() => {
        markSkill(newSkill);
        return Promise.resolve({
          outcome: RunOutcome.Failed,
          failure: { code: ErrorCodes.AgentApiError, message: 'failed' },
          snapshot,
        });
      });

      await runProgram('metrics', { installDir, run, credentials });

      expect(fs.existsSync(newSkill)).toBe(false);
      expect(fs.existsSync(oldSkill)).toBe(true);
    });

    it("a process drain mid-run removes this invocation's new skills", async () => {
      vi.mocked(runAgent).mockImplementation(() => {
        markSkill(newSkill);
        // What wizardAbort and the CLI roots' signal handlers call.
        runCleanups();
        return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
      });

      await runProgram('metrics', { installDir, run, credentials });

      expect(fs.existsSync(newSkill)).toBe(false);
      expect(fs.existsSync(oldSkill)).toBe(true);
    });

    it('deferSkillCommit keeps the handle until the host commits', async () => {
      await runProgram(
        'metrics',
        { installDir, run, credentials },
        { deferSkillCommit: true },
      );
      // A host that fails after the run still drains this invocation's skills.
      runCleanups();
      expect(fs.existsSync(newSkill)).toBe(false);

      await runProgram(
        'metrics',
        { installDir, run, credentials },
        { deferSkillCommit: true },
      );
      commitRegisteredRunSkillCleanups();
      runCleanups();
      expect(fs.existsSync(newSkill)).toBe(true);
      expect(fs.existsSync(oldSkill)).toBe(true);
    });

    it('commits its own handle after a successful run', async () => {
      await runProgram('metrics', { installDir, run, credentials });
      runCleanups();

      expect(fs.existsSync(newSkill)).toBe(true);
    });
  });
});
