import { runAgent, RunOutcome } from '@agent';
import { Harness, Sequence } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import type { RunResult } from '@agent/types';
import { ErrorCodes } from '@shared/errors';
import { DiscoveredFeature } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { refreshAccessToken } from '@utils/oauth';
import { oauthCredentials, resetOAuthSession } from '@shared/oauth-session';
import type { ResolvedProgramCredentials } from '../credentials';
import type { ProgramInput, ProgramOptions } from '../run-program';
import { runProgram } from '@programs';

vi.mock('@agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent')>()),
  runAgent: vi.fn(),
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
vi.mock('@utils/oauth', () => ({
  refreshAccessToken: vi.fn(),
  missingOAuthScopes: vi.fn(() => []),
}));
vi.mock('@utils/debug');

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

describe('runProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOAuthSession();
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
  });

  it("runs the caller's run definition, settings and route, and returns its final results", async () => {
    const excludedTaskTypes = () => ['logs'];
    const { signal } = new AbortController();
    const outcome = await runProgram(
      'metrics',
      {
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
        overrides: { harness: Harness.anthropic, sequence: Sequence.linear },
      },
      { signal },
    );

    const [config, input, agentOptions] = vi.mocked(runAgent).mock.calls[0];
    expect(config).toMatchObject({
      programId: 'metrics',
      run,
      agentFlow: 'metrics-flow',
      allowedTools: ['Agent'],
      disallowedTools: ['wizard_ask'],
      binding: { sequence: Sequence.linear, harness: Harness.anthropic },
      switchboard: {
        program: 'metrics',
        cliHarness: Harness.anthropic,
        cliSequence: Sequence.linear,
      },
      wizardMetadata: {
        program_id: 'metrics',
        integration: 'metrics',
        run_id: 'analytics-run-id',
        build: 'test',
        call_type: 'agent',
        SEQUENCE: Sequence.linear,
        HARNESS: Harness.anthropic,
      },
    });
    expect(config.excludedTaskTypes).toBe(excludedTaskTypes);
    expect(input.credentials).toBe(credentials.posthog);
    expect(agentOptions?.signal).toBe(signal);
    expect(analytics.setTag).toHaveBeenCalledWith('harness', Harness.anthropic);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'switchboard resolved',
      expect.objectContaining({ program: 'metrics', cli_harness: 'anthropic' }),
    );
    expect(outcome).toMatchObject({
      programId: 'metrics',
      outcome: RunOutcome.Success,
      data: { credentials: { projectId: 42 }, binding: config.binding },
      settledRuns: [
        { runId: 'run-1', result: { outcome: RunOutcome.Success } },
      ],
      diagnostics: [],
      artifacts: { reportFile: '/project/posthog-metrics-report.md' },
    });
    expect(outcome.failure).toBeUndefined();
  });

  const closed = () => Promise.reject(new Error('caller closed'));
  it.each<[string, () => ProgramOptions, RunOutcome, string]>([
    [
      'no credentials',
      () => ({}),
      RunOutcome.Failed,
      'Credentials are required to run metrics.',
    ],
    [
      'a rejecting credential provider',
      () => ({ credentials: { resolve: closed } }),
      RunOutcome.Failed,
      'caller closed',
    ],
    [
      'no org AI approval and no caller approval capability',
      () => ({ credentials: login(null) }),
      RunOutcome.Failed,
      'AI processing approval is required before this program can run.',
    ],
    [
      'a declined caller AI approval',
      () => ({
        credentials: login(null),
        awaitAiApproval: () => Promise.resolve(false),
      }),
      RunOutcome.Aborted,
      'AI processing approval declined.',
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

  it.each<[RunOutcome, RunResult['failure']]>([
    [
      RunOutcome.Failed,
      { code: ErrorCodes.AgentApiError, message: 'API Error' },
    ],
    [
      RunOutcome.Aborted,
      { code: ErrorCodes.AgentAbort, message: 'Agent run cancelled' },
    ],
    [
      RunOutcome.Crashed,
      {
        code: ErrorCodes.InternalUnhandled,
        message: 'mint refused',
        error: new Error('mint refused'),
      },
    ],
  ])(
    'a %s agent run settles with its failure and its run',
    async (outcome, failure) => {
      const result = { outcome, failure, snapshot } as RunResult;
      vi.mocked(runAgent).mockResolvedValueOnce(result);

      const settled = await runProgram('metrics', {
        installDir: '/project',
        runId: 'run-1',
        run,
        credentials,
      });

      expect(settled).toMatchObject({ outcome, failure });
      expect(settled.settledRuns).toEqual([{ runId: 'run-1', result }]);
    },
  );

  it.each([
    'credential resolution',
    'AI approval',
    'a post-auth gate',
  ] as const)(
    'a caller abort during %s reaches the capability, returns Aborted and starts nothing else',
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
          message: 'Run cancelled by the caller.',
        },
      });
      expect(runAgent).not.toHaveBeenCalled();
    },
  );

  it('a caller abort during the token refresh keeps the rotated refresh token', async () => {
    const controller = new AbortController();
    vi.mocked(refreshAccessToken).mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(refreshedToken);
    });

    const result = await runProgram(
      'metrics',
      {
        installDir: '/project',
        run,
        credentials: { ...credentials, posthog: aging() },
      },
      { signal: controller.signal },
    );

    expect(result.outcome).toBe(RunOutcome.Aborted);
    const rotated = {
      accessToken: 'pha_refreshed',
      refreshToken: 'phr_rotated',
    };
    expect(result.data.credentials).toMatchObject(rotated);
    expect(await oauthCredentials()).toMatchObject(rotated);
    expect(runAgent).not.toHaveBeenCalled();
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

  it('a caller mutation after the call does not reach the run', async () => {
    const flags = { ci: false };
    const host: NonNullable<ProgramInput['host']> = { region: 'us' };

    const pending = runProgram(
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
  });

  it('a provider is resolved once, then identified and stamped, and refreshed before the agent starts', async () => {
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
  });
});
