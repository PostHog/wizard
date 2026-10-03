import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_BINDING, runAgent, RunOutcome } from '@agent';
import { Harness, Integration, Sequence } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import type { AgentProgress, RunResult } from '@agent/types';
import { ErrorCodes } from '@shared/errors';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { OutroKind } from '@shared/outro';
import { RunPhase, ScanConsent } from '@shared/run-state';
import {
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
  type SettingsConflict,
} from '@shared/claude-settings';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { ServiceHealthStatus } from '@shared/health-checks/types';
import { analytics } from '@utils/analytics';
import { registerCleanup } from '@utils/cleanup';
import { logToFile } from '@utils/debug';
import { refreshAccessToken } from '../oauth/tokens';
import {
  configureOAuthSession,
  oauthCredentials,
  resetOAuthSession,
} from '@shared/oauth-session';
import { preinstallPostHogCliOnce } from '@programs/shared/posthog-cli-preinstall';
import type { ResolvedProgramCredentials } from '../credentials';
import type {
  ProgramInput,
  ProgramOptions,
  ProgramProgress,
  ProgramStep,
} from '../program-input';
import type { ProgramSession } from '../program-session';
import type { ProgramReadyContext } from '../program-step';
import type { ProgramRun } from '../program-run';
import type { CiRunnerContext, RunnerContext } from '../runner-context';
import type { WizardSession } from '../session/wizard-session';
import { AUDIT_CHECKS_KEY } from '@programs/audit';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import { detectErrorCode } from '../detect-map';
import { config as metrics } from '@programs/metrics';
import {
  buildSession,
  ProgramAbort,
  runProgram,
  SessionStore,
  TASK_OUTCOMES_KEY,
} from '@programs';

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
vi.mock(import('../oauth/tokens'), () => ({
  refreshAccessToken: vi.fn(),
  missingOAuthScopes: vi.fn(() => []),
}));
vi.mock('@utils/debug');
vi.mock(import('@utils/cleanup'), () => ({
  registerCleanup: vi.fn(() => () => undefined),
}));
vi.mock(import('@shared/health-checks/readiness'), async (importOriginal) => ({
  ...(await importOriginal()),
  evaluateWizardReadiness: vi.fn(),
}));
vi.mock(import('@programs/shared/posthog-cli-preinstall'), () => ({
  preinstallPostHogCliOnce: vi.fn(),
}));
vi.mock(import('@shared/claude-settings'), async (importOriginal) => ({
  ...(await importOriginal()),
  checkAllSettingsConflicts: vi.fn(),
  backupAndFixClaudeSettings: vi.fn(),
  restoreClaudeSettings: vi.fn(),
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

/** A caller's session store, as a host builds it from launch values. */
const store = (fields: Partial<WizardSession> = {}) => {
  const s = new SessionStore(buildSession({ installDir: '/project' }));
  s.update(fields);
  return s;
};

/** The metrics program with the test's run definition laid over it. */
const input = (over: Partial<ProgramInput> = {}): ProgramInput => ({
  store: store(),
  config: { run },
  ...over,
});

/** A host's workflow: answers every step with `answer(step)`, in the order asked. */
const workflow = (answer: (step: ProgramStep) => boolean = () => true) => {
  const steps: ProgramStep[] = [];
  return {
    steps,
    confirmStep: vi.fn((step: ProgramStep) => {
      steps.push(step);
      return Promise.resolve(answer(step));
    }),
    finishStep: vi.fn(),
  };
};

const readiness = (decision: WizardReadiness): WizardReadinessResult => ({
  decision,
  health: {
    skillsOrigin: {
      status:
        decision === WizardReadiness.No
          ? ServiceHealthStatus.Down
          : ServiceHealthStatus.Degraded,
    },
  },
  reasons: [],
});

const managedConflict: SettingsConflict = {
  source: 'managed',
  path: '/etc/claude/managed-settings.json',
  keys: ['ANTHROPIC_BASE_URL'],
  writable: false,
};

const agentConfig = (call = 0) => vi.mocked(runAgent).mock.calls[call][0];
const agentInput = (call = 0) => vi.mocked(runAgent).mock.calls[call][1];

describe('runProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOAuthSession();
    vi.mocked(runAgent).mockResolvedValue({
      outcome: RunOutcome.Success,
      snapshot,
    });
    vi.mocked(evaluateWizardReadiness).mockResolvedValue(
      readiness(WizardReadiness.Yes),
    );
    vi.mocked(checkAllSettingsConflicts).mockReturnValue([]);
    vi.mocked(backupAndFixClaudeSettings).mockReturnValue(true);
  });

  it("runs the registered program with the caller's config laid over it, routed by its binding, and records the run in the store", async () => {
    const excludedTaskTypes = () => ['logs'];
    const { signal } = new AbortController();
    const interaction = { ask: vi.fn() };
    const resolved = {
      sequence: Sequence.linear,
      harness: Harness.anthropic,
      model: 'm',
    };
    vi.mocked(runAgent).mockImplementationOnce((_config, _input, options) => {
      options?.onProgress?.({ kind: 'binding', binding: resolved });
      options?.onProgress?.({ kind: 'lifecycle', phase: 'started' });
      options?.onProgress?.({ kind: 'status', message: 'Installing' });
      options?.onProgress?.({
        kind: 'lifecycle',
        phase: 'completed',
        message: 'Metrics configured',
      });
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const s = store({ harness: Harness.anthropic, sequence: Sequence.linear });
    const seen: ProgramProgress[] = [];
    const outcome = await runProgram(
      'metrics',
      {
        store: s,
        runId: 'run-1',
        config: {
          run,
          agentFlow: 'metrics-flow',
          allowedTools: ['Agent'],
          disallowedTools: ['wizard_ask'],
          excludedTaskTypes,
        },
        credentials,
      },
      {
        signal,
        interaction,
        onProgress: (progress) => void seen.push(progress),
      },
    );

    const [config, runInput, agentOptions] = vi.mocked(runAgent).mock.calls[0];
    expect(config).toMatchObject({
      programId: 'metrics',
      run,
      agentFlow: 'metrics-flow',
      allowedTools: ['Agent'],
      disallowedTools: ['wizard_ask'],
      // The agent resolves the launch overrides and flags over the program's own binding.
      routing: {
        binding: metrics.binding,
        overrides: { harness: Harness.anthropic, sequence: Sequence.linear },
      },
    });
    expect(config.excludedTaskTypes).toBe(excludedTaskTypes);
    expect(runInput.credentials).toBe(credentials.posthog);
    expect(agentOptions?.signal).toBe(signal);
    // The agent asks and notices through the caller's answerer.
    expect(agentOptions?.interaction).toBe(interaction);
    expect(outcome).toMatchObject({
      programId: 'metrics',
      outcome: RunOutcome.Success,
      runResults: [{ outcome: RunOutcome.Success }],
      diagnostics: [],
      artifacts: { reportFile: '/project/posthog-metrics-report.md' },
    });
    expect(outcome.failure).toBeUndefined();
    // The route the agent reported reaches the observer, labelled with its run.
    expect(seen[0]).toEqual({
      runId: 'run-1',
      event: { kind: 'binding', binding: resolved },
    });
    // The run's state is in the caller's store.
    expect(s.session).toMatchObject({
      credentials: { projectId: 42 },
      skillId: 'metrics',
      runPhase: RunPhase.Completed,
      outroData: { kind: OutroKind.Success, message: 'Metrics configured' },
    });
    expect(s.statusMessages).toContain('Installing');
  });

  it('a composed run ends completed and leaves the outro to its caller', async () => {
    vi.mocked(runAgent).mockImplementationOnce((_config, _input, options) => {
      options?.onProgress?.({ kind: 'lifecycle', phase: 'started' });
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const s = store();

    const result = await runProgram(
      'metrics',
      input({ store: s, credentials, composed: true }),
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(s.session.runPhase).toBe(RunPhase.Completed);
    expect(s.session.outroData).toBeNull();
  });

  it('routes a program that declares no binding with the default one', async () => {
    await runProgram('not-registered', input({ credentials }));
    expect(agentConfig().routing.binding).toEqual(DEFAULT_BINDING);
    expect(agentConfig().programId).toBe('not-registered');
  });

  it('fails a program with no run configuration before anything starts', async () => {
    const s = store();
    const result = await runProgram('not-registered', {
      store: s,
      credentials,
    });
    expect(result).toMatchObject({
      outcome: RunOutcome.Failed,
      failure: {
        message: 'Program "not-registered" has no run configuration.',
      },
    });
    expect(evaluateWizardReadiness).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    // A settled failure is in the store, so a host's last push carries it.
    expect(s.session.runPhase).toBe(RunPhase.Error);
    expect(s.session.outroData).toMatchObject({
      kind: OutroKind.Error,
      errorCode: ErrorCodes.InternalUnhandled,
    });
  });

  describe('detection', () => {
    it("runs a CI session's ciPreRun on a copy of the session and keeps what it wrote", async () => {
      const s = store({ ci: true });
      const ciPreRun = vi.fn((session: ProgramSession) => {
        session.installDir = '/project/apps/web';
        session.frameworkContext.scanned = true;
        return Promise.resolve();
      });
      await runProgram(
        'metrics',
        { store: s, config: { run, ciPreRun }, credentials },
        {},
      );
      expect(ciPreRun).toHaveBeenCalledOnce();
      expect(s.session.detectionComplete).toBe(true);
      expect(s.session.frameworkContext.scanned).toBe(true);
      expect(agentInput().installDir).toBe('/project/apps/web');
    });

    it("gives a CI ciPreRun's copy of the session the login it asked for", async () => {
      let seen: WizardSession['credentials'] = null;
      const ciPreRun = async (
        session: ProgramSession,
        runner: CiRunnerContext,
      ) => {
        await runner.authenticate('metrics');
        seen = session.credentials;
      };
      const s = store({ ci: true });
      await runProgram(
        'metrics',
        { store: s, config: { run, ciPreRun }, credentials },
        {},
      );
      expect(seen).toBe(credentials.posthog);
      expect(s.session.credentials).toBe(credentials.posthog);
    });

    it("ends a ProgramAbort from a CI ciPreRun as an aborted run, as main's decided stop ended", async () => {
      const s = store({ ci: true });
      const result = await runProgram(
        'metrics',
        {
          store: s,
          config: {
            run,
            ciPreRun: () =>
              Promise.reject(
                new ProgramAbort({
                  code: ErrorCodes.DetectNoFramework,
                  message: 'Could not auto-detect your framework.',
                }),
              ),
          },
          credentials,
        },
        {},
      );
      expect(result).toMatchObject({
        outcome: RunOutcome.Aborted,
        failure: { code: ErrorCodes.DetectNoFramework },
      });
      expect(s.session.outroData?.errorCode).toBe(ErrorCodes.DetectNoFramework);
      expect(runAgent).not.toHaveBeenCalled();
    });

    it("reports a CI detection's log lines as the program's own progress", async () => {
      const seen: ProgramProgress[] = [];
      const ciPreRun = (_session: ProgramSession, runner: CiRunnerContext) => {
        runner.log.info('Scanning the repo');
        runner.log.warn('Scan failed');
        return Promise.resolve();
      };
      await runProgram(
        'metrics',
        { store: store({ ci: true }), config: { run, ciPreRun }, credentials },
        { onProgress: (progress) => void seen.push(progress) },
      );
      expect(seen.map((p) => p.event).slice(0, 2)).toEqual([
        { kind: 'log', level: 'info', message: 'Scanning the repo' },
        { kind: 'log', level: 'warn', message: 'Scan failed' },
      ]);
    });

    it('skips the detection a host already ran', async () => {
      const onReady = vi.fn();
      await runProgram(
        'metrics',
        input({
          store: store({ detectionComplete: true }),
          config: { run, onReady },
          credentials,
        }),
      );
      expect(onReady).not.toHaveBeenCalled();
    });

    it('crashes on a CI ciPreRun that throws, keeping the error for the host', async () => {
      const s = store({ ci: true });
      const crash = new Error('detector crashed');
      const result = await runProgram(
        'metrics',
        {
          store: s,
          config: {
            run,
            ciPreRun: () => Promise.reject(crash),
          },
          credentials,
        },
        {},
      );
      expect(result).toMatchObject({
        outcome: RunOutcome.Crashed,
        failure: {
          code: ErrorCodes.InternalUnhandled,
          message: 'detector crashed',
          error: crash,
        },
      });
      expect(s.session.runPhase).toBe(RunPhase.Error);
      expect(runAgent).not.toHaveBeenCalled();
    });

    it('fails an unmet prerequisite with its code and detail before any login', async () => {
      const resolve = vi.fn();
      const onReady = vi.fn((ctx: ProgramReadyContext) =>
        ctx.setFrameworkContext('detectError', { kind: 'not-a-git-repo' }),
      );
      const s = store();
      const result = await runProgram(
        'metrics',
        { store: s, config: { run, onReady } },
        { credentials: { resolve } },
      );
      expect(result).toMatchObject({
        outcome: RunOutcome.Failed,
        failure: {
          code: detectErrorCode('not-a-git-repo'),
          detail: { kind: 'not-a-git-repo' },
          message: expect.stringContaining('Prerequisites not met'),
        },
      });
      expect(s.session.outroData?.errorCode).toBe(
        detectErrorCode('not-a-git-repo'),
      );
      expect(resolve).not.toHaveBeenCalled();
      expect(runAgent).not.toHaveBeenCalled();
    });
  });

  describe('the run definition', () => {
    it('builds the run from config.run on a copy of the session, keeps what it wrote, and labels the skill', async () => {
      const s = store();
      const build = vi.fn((session: ProgramSession, runner: RunnerContext) => {
        runner.setFrameworkContext('picked', 'ios');
        session.typescript = true;
        return Promise.resolve({ ...run, skillId: 'skill-x' } as ProgramRun);
      });

      await runProgram('metrics', {
        store: s,
        config: { run: build },
        credentials,
      });

      expect(build).toHaveBeenCalledWith(
        expect.objectContaining({ installDir: '/project' }),
        expect.any(Object),
      );
      expect(s.session.frameworkContext.picked).toBe('ios');
      expect(s.session.typescript).toBe(true);
      expect(s.session.skillId).toBe('skill-x');
      expect(agentConfig().run).toMatchObject({ skillId: 'skill-x' });
      expect(agentInput().skillId).toBe('skill-x');
    });

    it("reports config.run's log lines and spinner as the program's own progress", async () => {
      const seen: ProgramProgress[] = [];
      await runProgram(
        'metrics',
        input({
          runId: 'run-1',
          config: {
            run: (_session: ProgramSession, runner: RunnerContext) => {
              runner.log.warn('Installing the CLI');
              runner.spinner().start('Working');
              return Promise.resolve(run as ProgramRun);
            },
          },
          credentials,
        }),
        { onProgress: (progress) => void seen.push(progress) },
      );
      expect(seen.slice(0, 2)).toEqual([
        {
          runId: 'run-1',
          event: { kind: 'log', level: 'warn', message: 'Installing the CLI' },
        },
        {
          runId: 'run-1',
          event: { kind: 'spinner', action: 'start', message: 'Working' },
        },
      ]);
    });

    it('turns a ProgramAbort from config.run into a failed outcome with its code, before any preflight or login', async () => {
      const resolve = vi.fn();
      const s = store();
      const result = await runProgram(
        'metrics',
        {
          store: s,
          config: {
            run: () =>
              Promise.reject(
                new ProgramAbort({
                  code: ErrorCodes.DetectUnsupportedPlatform,
                  message: 'Not supported yet',
                }),
              ),
          },
        },
        { credentials: { resolve } },
      );

      expect(result).toMatchObject({
        outcome: RunOutcome.Failed,
        failure: {
          code: ErrorCodes.DetectUnsupportedPlatform,
          message: 'Not supported yet',
        },
      });
      expect(s.session.outroData?.errorCode).toBe(
        ErrorCodes.DetectUnsupportedPlatform,
      );
      expect(evaluateWizardReadiness).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
      expect(runAgent).not.toHaveBeenCalled();
    });

    it('rethrows any other error config.run throws, after recording it in the store', async () => {
      const error = new Error('detector crashed');
      const s = store();
      await expect(
        runProgram(
          'metrics',
          input({
            store: s,
            config: { run: () => Promise.reject(error) },
            credentials,
          }),
        ),
      ).rejects.toBe(error);
      expect(runAgent).not.toHaveBeenCalled();
      expect(s.session.runPhase).toBe(RunPhase.Error);
      expect(s.session.outroData).toMatchObject({
        kind: OutroKind.Error,
        message: 'detector crashed',
        errorCode: ErrorCodes.InternalUnhandled,
      });
    });

    it("binds the run's hooks and seed tasks to the store's session", async () => {
      const s = store();
      const postRun = vi.fn(() => Promise.resolve());
      const buildOutroData = vi.fn(() => null);
      const nextSteps = { heading: 'Next', items: ['next'] };
      const buildOutroNextSteps = vi.fn(() => nextSteps);
      const seedTasks = vi.fn(() => []);

      await runProgram('metrics', {
        store: s,
        config: {
          run: { ...run, postRun, buildOutroData, buildOutroNextSteps },
          seedTasks,
        },
        credentials,
      });

      const { hooks, seedTasks: boundSeed } = agentConfig();
      const creds = credentials.posthog;
      await hooks?.postRun?.(creds);
      expect(postRun).toHaveBeenCalledWith(s.session, creds);
      // A null outro becomes "none", so the agent builds its default.
      expect(hooks?.buildOutroData?.(creds)).toBeUndefined();
      expect(buildOutroData).toHaveBeenCalledWith(s.session, creds);
      expect(hooks?.buildOutroNextSteps?.(creds, ['install'])).toBe(nextSteps);
      expect(buildOutroNextSteps).toHaveBeenCalledWith(s.session, creds, [
        'install',
      ]);
      hooks?.recordTaskOutcomes?.([]);
      expect(s.session.frameworkContext[TASK_OUTCOMES_KEY]).toEqual([]);
      boundSeed?.();
      expect(seedTasks).toHaveBeenCalledWith(s.session);
    });

    it("derives the run input from the store's launch values", async () => {
      await runProgram('metrics', {
        store: store({
          ci: true,
          debug: true,
          yaraReport: true,
          e2eAsk: true,
          projectId: 7,
          apiKey: 'phx_session',
          region: 'eu',
          integration: Integration.nextjs,
        }),
        config: { run },
        credentials,
      });

      expect(agentInput()).toMatchObject({
        installDir: '/project',
        skillId: 'metrics',
        integration: Integration.nextjs,
        frameworkDocsUrl:
          FRAMEWORK_REGISTRY[Integration.nextjs].metadata.docsUrl,
        flags: {
          ci: true,
          signup: false,
          debug: true,
          yaraReport: true,
          e2eAsk: true,
          localMcp: false,
        },
        host: { projectId: 7, apiKey: 'phx_session', region: 'eu' },
      });
    });
  });

  describe('the preflight', () => {
    it.each<[string, ReturnType<typeof workflow> | undefined]>([
      ['no workflow', undefined],
      ['a workflow that continues', workflow()],
    ])('a blocking outage with %s runs anyway', async (_case, host) => {
      vi.mocked(evaluateWizardReadiness).mockResolvedValueOnce(
        readiness(WizardReadiness.No),
      );
      const s = store();
      const warnings: string[] = [];
      const result = await runProgram(
        'metrics',
        input({ store: s, credentials }),
        {
          workflow: host,
          onProgress: ({ event }) => {
            if (event.kind === 'log') warnings.push(event.message);
          },
        },
      );
      expect(result.outcome).toBe(RunOutcome.Success);
      expect(runAgent).toHaveBeenCalledOnce();
      expect(s.session.readinessResult?.decision).toBe(WizardReadiness.No);
      // With nobody to ask, the outage is reported as the run goes on.
      if (!host) {
        expect(warnings).toContain('Service health issues detected.');
        expect(warnings.join('\n')).toContain('✖ Skills download: down');
      }
    });

    it('a blocking outage the host declines fails the run before any login', async () => {
      const outage = readiness(WizardReadiness.No);
      vi.mocked(evaluateWizardReadiness).mockResolvedValueOnce(outage);
      const host = workflow((step) => step.kind !== 'service-outage');
      const resolve = vi.fn();

      const result = await runProgram('metrics', input(), {
        workflow: host,
        credentials: { resolve },
      });

      expect(host.steps).toEqual([
        expect.objectContaining({ kind: 'service-outage', readiness: outage }),
      ]);
      expect(result).toMatchObject({
        outcome: RunOutcome.Failed,
        failure: {
          code: ErrorCodes.EnvServiceOutage,
          message: expect.stringContaining('Skills download (down)'),
        },
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(runAgent).not.toHaveBeenCalled();
    });

    it('reports degraded services that do not block, and runs', async () => {
      const degraded = readiness(WizardReadiness.YesWithWarnings);
      vi.mocked(evaluateWizardReadiness).mockResolvedValueOnce(degraded);
      const s = store();
      const seen: AgentProgress[] = [];

      const result = await runProgram(
        'metrics',
        input({ store: s, credentials }),
        { onProgress: ({ event }) => void seen.push(event) },
      );

      expect(seen[0]).toEqual({
        kind: 'log',
        level: 'warn',
        message: 'Service health warnings detected.',
      });
      expect(s.session.readinessResult).toEqual(degraded);
      expect(result.outcome).toBe(RunOutcome.Success);
    });

    it.each<[string, () => Partial<ProgramInput>]>([
      [
        'the host already ran it',
        () => ({
          store: store({ readinessResult: readiness(WizardReadiness.No) }),
        }),
      ],
      ['the program opts out', () => ({ config: { run, healthCheck: false } })],
    ])('skips the health check when %s', async (_case, over) => {
      const host = workflow();
      const result = await runProgram(
        'metrics',
        input({ credentials, ...over() }),
        { workflow: host },
      );
      expect(evaluateWizardReadiness).not.toHaveBeenCalled();
      expect(host.steps.map((step) => step.kind)).not.toContain(
        'service-outage',
      );
      expect(result.outcome).toBe(RunOutcome.Success);
    });

    it('fails closed on a settings conflict it cannot neutralize when there is no host to ask', async () => {
      vi.mocked(checkAllSettingsConflicts).mockReturnValueOnce([
        managedConflict,
      ]);

      const result = await runProgram('metrics', input({ credentials }));

      expect(result).toMatchObject({
        outcome: RunOutcome.Failed,
        failure: {
          code: ErrorCodes.SettingsUnfixableConflict,
          message: expect.stringContaining('ANTHROPIC_BASE_URL'),
        },
      });
      expect(runAgent).not.toHaveBeenCalled();
    });

    it('hands an unfixable conflict to the host with a fix it can apply, then runs and puts the settings back', async () => {
      vi.mocked(checkAllSettingsConflicts).mockReturnValueOnce([
        managedConflict,
      ]);
      const host = workflow((step) => {
        if (step.kind === 'settings-conflict') step.fix();
        return true;
      });

      const result = await runProgram('metrics', input({ credentials }), {
        workflow: host,
      });

      expect(host.steps).toContainEqual(
        expect.objectContaining({
          kind: 'settings-conflict',
          conflicts: [managedConflict],
        }),
      );
      expect(backupAndFixClaudeSettings).toHaveBeenCalledWith('/project');
      expect(result.outcome).toBe(RunOutcome.Success);
      expect(restoreClaudeSettings).toHaveBeenCalledWith('/project');
    });

    it.each([
      [true, RunOutcome.Success],
      [false, RunOutcome.Failed],
    ])(
      'backs up a writable project settings conflict without asking (backed up: %s → %s)',
      async (backedUp, outcome) => {
        vi.mocked(checkAllSettingsConflicts).mockReturnValueOnce([
          { ...managedConflict, source: 'project', writable: true },
        ]);
        vi.mocked(backupAndFixClaudeSettings).mockReturnValueOnce(backedUp);

        const result = await runProgram('metrics', input({ credentials }));

        expect(backupAndFixClaudeSettings).toHaveBeenCalledWith('/project');
        expect(result.outcome).toBe(outcome);
        if (backedUp) {
          // The run neutralized them for itself; they're back once it settles.
          expect(restoreClaudeSettings).toHaveBeenCalledWith('/project');
        } else {
          expect(result.failure?.code).toBe(
            ErrorCodes.SettingsUnfixableConflict,
          );
        }
      },
    );
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
      'no org AI approval and no host to ask',
      () => ({ credentials: login(null) }),
      RunOutcome.Failed,
      'AI processing approval is required before this program can run.',
    ],
    [
      'an AI approval the host declines',
      () => ({
        credentials: login(null),
        workflow: workflow((step) => step.kind !== 'ai-approval'),
      }),
      RunOutcome.Aborted,
      'AI processing approval declined.',
    ],
  ])(
    '%s is a decided result before the agent it guards',
    async (_case, options, outcome, message) => {
      const result = await runProgram('metrics', input(), options());

      expect(result).toMatchObject({ outcome, failure: { message } });
      expect(result.runResults).toHaveLength(0);
      expect(runAgent).not.toHaveBeenCalled();
    },
  );

  it.each([{ ci: true }, { signup: true }])(
    'skips the AI approval for a %o session',
    async (fields) => {
      const result = await runProgram(
        'metrics',
        input({ store: store(fields) }),
        { credentials: login(null) },
      );

      expect(result.outcome).toBe(RunOutcome.Success);
      expect(runAgent).toHaveBeenCalledTimes(1);
    },
  );

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
    'a %s agent run settles with its failure and its run, recorded in the store',
    async (outcome, failure) => {
      const result = { outcome, failure, snapshot } as RunResult;
      vi.mocked(runAgent).mockResolvedValueOnce(result);
      const s = store();

      const settled = await runProgram(
        'metrics',
        input({ store: s, runId: 'run-1', credentials }),
      );

      expect(settled).toMatchObject({ outcome, failure });
      expect(settled.runResults).toEqual([result]);
      expect(s.session.runPhase).toBe(RunPhase.Error);
      expect(s.session.outroData).toMatchObject({
        kind: OutroKind.Error,
        message: failure?.message,
        errorCode: failure?.code,
      });
    },
  );

  it.each(['credential resolution', 'AI approval', 'the run step'] as const)(
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
      const parkOn =
        (kind: ProgramStep['kind']) =>
        (step: ProgramStep, context: { signal: AbortSignal }) =>
          step.kind === kind ? park(step, context) : Promise.resolve(true);
      const options: ProgramOptions = {
        'credential resolution': { credentials: { resolve: park } },
        'AI approval': {
          credentials: login(null),
          workflow: { confirmStep: parkOn('ai-approval') },
        },
        'the run step': {
          credentials: login(),
          workflow: { confirmStep: parkOn('run') },
        },
      }[gate];

      const pending = runProgram('metrics', input(), {
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
    const s = store();

    const result = await runProgram(
      'metrics',
      input({ store: s, credentials: { ...credentials, posthog: aging() } }),
      { signal: controller.signal },
    );

    expect(result.outcome).toBe(RunOutcome.Aborted);
    const rotated = {
      accessToken: 'pha_refreshed',
      refreshToken: 'phr_rotated',
    };
    expect(s.session.credentials).toMatchObject(rotated);
    expect(await oauthCredentials()).toMatchObject(rotated);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('runs in order: readiness, agent started, settings, credentials, approval, flags, the run step, refresh, agent', async () => {
    const order: string[] = [];
    const answer = <T>(name: string, value: T) =>
      vi.fn(() => {
        order.push(name);
        return Promise.resolve(value);
      });
    vi.mocked(evaluateWizardReadiness).mockImplementationOnce(
      answer('readiness', readiness(WizardReadiness.Yes)),
    );
    vi.mocked(checkAllSettingsConflicts).mockImplementationOnce(() => {
      order.push('settings');
      return [];
    });
    vi.mocked(analytics.wizardCapture).mockImplementationOnce((event) => {
      order.push(event);
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
    const host = workflow((step) => {
      order.push(step.kind === 'run' ? `run step ${step.stepId}` : step.kind);
      return true;
    });

    const result = await runProgram(
      'metrics',
      input({
        config: {
          run: { ...run, integrationLabel: 'custom-label', skillId: 'skill-x' },
        },
      }),
      {
        credentials: {
          resolve: answer('credentials', {
            ...credentials,
            posthog: aging(),
            apiUser: null,
          }),
        },
        workflow: host,
        featureFlags: answer('flags', flags),
      },
    );

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(order).toEqual([
      'readiness',
      'agent started',
      'settings',
      'credentials',
      'ai-approval',
      'flags',
      'run step run',
      'refresh',
      'runAgent',
    ]);
    expect(analytics.wizardCapture).toHaveBeenCalledWith('agent started', {
      integration: 'custom-label',
      program_id: 'metrics',
      skill_id: 'skill-x',
    });
    expect(agentConfig()).toMatchObject({
      wizardFlags: flags.flags,
      wizardFlagPayloads: flags.payloads,
    });
  });

  it("each agent run uses this run's login even when another is held", async () => {
    let parked = false;
    let release: (go: boolean) => void = () => undefined;
    const host = {
      confirmStep: (step: ProgramStep) =>
        step.kind === 'run'
          ? new Promise<boolean>((resolve) => {
              parked = true;
              release = resolve;
            })
          : Promise.resolve(true),
    };

    const pending = runProgram('metrics', input({ credentials }), {
      workflow: host,
    });
    await vi.waitFor(() => expect(parked).toBe(true));
    configureOAuthSession(
      { ...credentials.posthog, accessToken: 'phx_other', projectId: 99 },
      { rotate: (held) => Promise.resolve(held) },
    );
    release(true);
    await pending;

    expect(agentInput().credentials.projectId).toBe(42);
  });

  it('a caller mutation after the call does not reach the run', async () => {
    const wizardFlags = { 'wizard-test-flag': 'on' };

    const pending = runProgram('metrics', input({ wizardFlags }), {
      credentials: login(),
    });
    wizardFlags['wizard-test-flag'] = 'off';
    await pending;

    expect(agentConfig().wizardFlags).toEqual({ 'wizard-test-flag': 'on' });
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
    const s = store({
      scanConsent: ScanConsent.Granted,
      discoveredFeatures: [DiscoveredFeature.LLM],
      baseUrl: 'https://posthog.example',
    });

    await runProgram('metrics', input({ store: s }), {
      credentials: { resolve },
    });

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
    expect(agentInput().credentials.accessToken).toBe('pha_refreshed');
    expect(s.session).toMatchObject({
      credentials: { refreshToken: 'phr_rotated' },
      aiSdkStampReported: true,
    });
  });

  it("reuses the store's login and records a refreshed token on it, keeping its host", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(refreshedToken);
    const resolve = vi.fn();
    const s = store({ credentials: aging(), apiUser: credentials.apiUser });

    await runProgram('metrics', input({ store: s }), {
      credentials: { resolve },
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(agentInput().credentials.accessToken).toBe('pha_refreshed');
    expect(s.session.credentials?.accessToken).toBe('pha_refreshed');
    expect(s.session.credentials?.refreshToken).toBe('phr_rotated');
    expect(s.session.credentials?.host).toBeInstanceOf(HostResolution);
    expect(s.session.aiSdkStampReported).toBe(true);
  });

  it('keeps a throwing observer as a diagnostic, not a failure, and ignores a late event', async () => {
    let late: ((event: AgentProgress) => void) | undefined;
    vi.mocked(runAgent).mockImplementationOnce((_config, _input, options) => {
      late = options?.onProgress;
      options?.onProgress?.({ kind: 'status', message: 'Installing' });
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });
    const s = store();
    const result = await runProgram(
      'metrics',
      input({ store: s, runId: 'run-1', credentials }),
      {
        onProgress: () => {
          throw new Error('observer broke');
        },
      },
    );
    late?.({ kind: 'status', message: 'After' });

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(result.diagnostics).toEqual([
      { runId: 'run-1', eventKind: 'status', message: 'observer broke' },
    ]);
    // The store still has the event the observer threw on, and not the late one.
    expect(s.statusMessages).toEqual(['Installing']);
  });

  it("pre-installs error-tracking's posthog-cli for the project the host picks before its run step", async () => {
    const s = store({ detectionComplete: true });
    const host = workflow((step) => {
      // The TUI's project pick lands before it confirms the run step.
      if (step.kind === 'run') s.update({ integration: Integration.swift });
      return true;
    });

    await runProgram(
      'error-tracking',
      { store: s, credentials },
      { workflow: host },
    );

    expect(preinstallPostHogCliOnce).toHaveBeenCalledWith(
      'error tracking posthog-cli preinstall failed',
      { integration: Integration.swift },
      expect.anything(),
    );
    expect(runAgent).toHaveBeenCalledOnce();
  });

  describe('composed runs', () => {
    const composed = (prep = vi.fn()) => ({
      run,
      runSteps: {
        'integrate-run': {
          runProgramId: 'metrics',
          targetDir: () => '/project/apps/web',
          onRunPrep: prep,
        },
      },
    });

    it('with a workflow, runs each run step it confirms, then its own run, each reported', async () => {
      const prep = vi.fn((session: ProgramSession) => {
        session.frameworkContext.picked = 'web';
        return Promise.resolve();
      });
      const host = workflow();
      // The host ran self-driving's detection before the run.
      const s = store({ detectionComplete: true });

      const result = await runProgram(
        'self-driving',
        { store: s, config: composed(prep), credentials },
        { workflow: host },
      );

      expect(result.outcome).toBe(RunOutcome.Success);
      expect(result.runResults).toHaveLength(2);
      expect(agentConfig(0)).toMatchObject({
        programId: 'metrics',
        composed: true,
      });
      expect(agentInput(0).installDir).toBe('/project/apps/web');
      expect(agentConfig(1)).toMatchObject({
        programId: 'self-driving',
        composed: false,
      });
      expect(agentInput(1).installDir).toBe('/project');
      expect(host.steps.filter((step) => step.kind === 'run')).toEqual([
        expect.objectContaining({
          stepId: 'integrate-run',
          programId: 'metrics',
        }),
        expect.objectContaining({ stepId: 'run', programId: 'self-driving' }),
      ]);
      expect(host.finishStep).toHaveBeenCalledTimes(2);
      // A scoped run's prep writes stay in its own copy of the session.
      expect(prep).toHaveBeenCalledOnce();
      expect(s.session.frameworkContext.picked).toBeUndefined();
    });

    it('copies a framework a run step detects back to the store', async () => {
      const prep = vi.fn((session: ProgramSession) => {
        session.detectedFrameworkLabel = 'Django';
        return Promise.resolve();
      });
      const s = store({ detectionComplete: true });

      await runProgram(
        'self-driving',
        { store: s, config: composed(prep), credentials },
        { workflow: workflow() },
      );

      expect(s.session.detectedFrameworkLabel).toBe('Django');
    });

    it('skips a run step the host declines', async () => {
      const host = workflow(
        (step) => step.kind !== 'run' || step.stepId !== 'integrate-run',
      );

      await runProgram(
        'self-driving',
        input({
          store: store({ detectionComplete: true }),
          config: composed(),
          credentials,
        }),
        { workflow: host },
      );

      expect(runAgent).toHaveBeenCalledOnce();
      expect(agentConfig().programId).toBe('self-driving');
    });

    it('with no workflow, runs only its own run', async () => {
      await runProgram(
        'self-driving',
        input({
          store: store({ detectionComplete: true }),
          config: composed(),
          credentials,
        }),
      );

      expect(runAgent).toHaveBeenCalledOnce();
      expect(agentConfig().programId).toBe('self-driving');
    });
  });

  describe('the audit ledger', () => {
    let installDir: string;
    const ledgerFile = '.posthog-audit-checks.json';
    const ledgerPath = () => path.join(installDir, ledgerFile);
    const audit = (s = new SessionStore(buildSession({ installDir }))) => ({
      store: s,
      config: { run, auditLedgerFile: ledgerFile },
      credentials,
    });
    /** The agent seeds the ledger and, like a real run, never runs the `rm`. */
    const seedThen =
      (finish: typeof runAgent): typeof runAgent =>
      (...args) => {
        fs.writeFileSync(ledgerPath(), '[]');
        return finish(...args);
      };
    const succeed: typeof runAgent = () =>
      Promise.resolve({ outcome: RunOutcome.Success, snapshot });

    beforeEach(() => {
      installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ledger-'));
    });
    afterEach(() => fs.rmSync(installDir, { recursive: true, force: true }));

    it('is removed from the project once the run settles', async () => {
      vi.mocked(runAgent).mockImplementation(seedThen(succeed));
      await runProgram('audit', audit());
      expect(fs.existsSync(ledgerPath())).toBe(false);
    });

    it('is removed when the run throws', async () => {
      const error = new Error('agent crashed');
      vi.mocked(runAgent).mockImplementation(
        seedThen(() => Promise.reject(error)),
      );
      await expect(runProgram('audit', audit())).rejects.toBe(error);
      expect(fs.existsSync(ledgerPath())).toBe(false);
    });

    it('is removed by the abort cleanup', async () => {
      const onAbort: Array<() => void> = [];
      vi.mocked(registerCleanup).mockImplementation((fn) => {
        onAbort.push(fn);
        return () => undefined;
      });
      let leftAfterAbort = true;
      vi.mocked(runAgent).mockImplementation(
        seedThen((...args) => {
          onAbort.forEach((fn) => fn());
          leftAfterAbort = fs.existsSync(ledgerPath());
          return succeed(...args);
        }),
      );
      await runProgram('audit', audit());
      expect(leftAfterAbort).toBe(false);
    });

    it('keeps a finished run a success when the ledger cannot be removed', async () => {
      vi.mocked(runAgent).mockImplementation((...args) => {
        fs.mkdirSync(ledgerPath());
        return succeed(...args);
      });
      const result = await runProgram('audit', audit());
      expect(result.outcome).toBe(RunOutcome.Success);
      expect(logToFile).toHaveBeenCalledWith(
        expect.stringContaining('[audit-ledger] could not remove'),
      );
    });

    it('mirrors a last write the watcher has not read yet into the store', async () => {
      const checks = [
        { id: 'sdk', area: 'SDK', label: 'Install the SDK', status: 'pass' },
      ];
      vi.mocked(runAgent).mockImplementation((...args) => {
        fs.writeFileSync(ledgerPath(), JSON.stringify(checks));
        return succeed(...args);
      });
      const s = new SessionStore(buildSession({ installDir }));
      await runProgram('audit', audit(s));
      expect(s.session.frameworkContext[AUDIT_CHECKS_KEY]).toEqual(checks);
    });
  });
});
