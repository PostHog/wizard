import { bootstrapProgram } from '../bootstrap';
import { authenticate, refreshAccessTokenIfNeeded } from '../authenticate';
import { buildSession, type Credentials } from '@lib/wizard-session';
import { HostResolution } from '@lib/host-resolution';
import { gatewayAuth } from '@lib/gateway-session';
import { createTriageLLMProvider } from '@lib/agent/triage-provider';
import {
  checkLlmGatewayHealth,
  checkSkillsOriginHealth,
} from '@lib/health-checks/endpoints';
import {
  WizardReadiness,
  type WizardReadinessResult,
} from '@lib/health-checks/readiness';
import { ServiceHealthStatus } from '@lib/health-checks/types';
import { wizardAbort } from '@utils/wizard-abort';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '../types';

const ui = vi.hoisted(() => ({
  showBlockingOutage: vi.fn<() => Promise<void>>(),
  waitForAiOptIn: vi.fn<() => Promise<void>>(),
  waitForGate: vi.fn<() => Promise<void>>(),
}));

vi.mock('@ui', () => ({ getUI: () => ui }));
vi.mock('../authenticate', () => ({
  authenticate: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
}));
vi.mock('@lib/gateway-session', () => ({ gatewayAuth: vi.fn() }));
vi.mock('@lib/health-checks/endpoints', () => ({
  checkLlmGatewayHealth: vi.fn(),
  checkSkillsOriginHealth: vi.fn(),
}));
vi.mock('@lib/agent/triage-provider', () => ({
  createTriageLLMProvider: vi.fn(),
}));
vi.mock('@lib/programs/posthog-integration/detect', () => ({
  maybeStampAiSdkDetected: vi.fn(),
}));
vi.mock('@lib/agent/runner/switchboard', () => ({
  resolveHarness: () => ({ harness: 'anthropic' }),
}));
vi.mock('@lib/agent/agent-interface', () => ({ buildRunTags: () => ({}) }));
vi.mock('@lib/agent/claude-settings', () => ({
  checkAllSettingsConflicts: () => [],
  backupAndFixClaudeSettings: vi.fn(),
  classifySettingsConflicts: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    build: 'test',
    runId: 'test-run',
    wizardCapture: vi.fn(),
    getAllFlagsForWizard: () => Promise.resolve({}),
    getWizardFlagPayloads: () => ({}),
  },
}));
vi.mock('@utils/debug', () => ({
  initLogFile: vi.fn(),
  logToFile: vi.fn(),
  enableDebugLogs: vi.fn(),
}));
vi.mock('@utils/wizard-abort', () => ({ wizardAbort: vi.fn() }));

const run: ProgramRun = {
  integrationLabel: 'health-test',
  spinnerMessage: 'Running',
  successMessage: 'Done',
  estimatedDurationMinutes: 1,
  reportFile: 'report.md',
  docsUrl: 'https://example.com/docs',
};

function program(hasHealthScreen = true): ProgramConfig {
  return {
    id: 'health-test',
    description: 'Health lifecycle test',
    steps: [
      ...(hasHealthScreen
        ? [{ id: 'health', label: 'Health', screenId: 'health-check' }]
        : []),
      { id: 'auth', label: 'Auth', screenId: 'auth' },
      { id: 'run', label: 'Run', screenId: 'run' },
    ],
  };
}

function credentials(accessToken = 'test-access-token'): Credentials {
  return {
    accessToken,
    projectApiKey: 'test-project-key',
    host: HostResolution.fromRegion('us'),
    projectId: 1,
  };
}

function preflight(status: ServiceHealthStatus): WizardReadinessResult {
  return {
    decision:
      status === ServiceHealthStatus.Healthy
        ? WizardReadiness.Yes
        : WizardReadiness.No,
    health: { skillsOrigin: { status } },
    reasons: [],
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('bootstrap health lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    ui.showBlockingOutage.mockResolvedValue();
    ui.waitForAiOptIn.mockResolvedValue();
    ui.waitForGate.mockResolvedValue();
    vi.mocked(authenticate).mockImplementation((session) => {
      session.credentials = credentials();
      return Promise.resolve();
    });
    vi.mocked(refreshAccessTokenIfNeeded).mockResolvedValue();
    vi.mocked(gatewayAuth).mockResolvedValue({
      gatewayUrl: 'https://gateway.example.com',
      token: 'test-scoped-token',
      refreshAtMs: Date.now() + 60_000,
    });
    vi.mocked(checkSkillsOriginHealth).mockResolvedValue({
      status: ServiceHealthStatus.Healthy,
    });
    vi.mocked(checkLlmGatewayHealth).mockResolvedValue({
      status: ServiceHealthStatus.Healthy,
    });
  });

  it.each([
    'https://gateway.eu.example.com',
    'http://localhost:8766',
    'https://custom.example.com/nested/gateway',
  ])(
    'checks the minted URL %s despite a cached healthy preflight',
    async (url) => {
      const session = buildSession({});
      session.readinessResult = preflight(ServiceHealthStatus.Healthy);
      const mint = deferred();
      vi.mocked(gatewayAuth).mockImplementation(async () => {
        await mint.promise;
        return {
          gatewayUrl: url,
          token: 'test-scoped-token',
          refreshAtMs: 60_000,
        };
      });

      const boot = bootstrapProgram(session, run, program());
      await vi.waitFor(() => expect(gatewayAuth).toHaveBeenCalledOnce());
      expect(authenticate).toHaveBeenCalledOnce();
      expect(checkLlmGatewayHealth).not.toHaveBeenCalled();

      mint.resolve();
      await boot;

      expect(checkLlmGatewayHealth).toHaveBeenCalledExactlyOnceWith(url);
      expect(checkSkillsOriginHealth).not.toHaveBeenCalled();
      expect(ui.showBlockingOutage).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'skips advisory checks without a health screen (signup=%s)',
    async (signup) => {
      await bootstrapProgram(buildSession({ signup }), run, program(false));

      expect(checkSkillsOriginHealth).not.toHaveBeenCalled();
      expect(checkLlmGatewayHealth).not.toHaveBeenCalled();
      expect(ui.showBlockingOutage).not.toHaveBeenCalled();
      expect(gatewayAuth).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    'waits for a skills outage dismissal before auth, then checks the gateway (signup=%s)',
    async (signup) => {
      const dismissal = deferred();
      ui.showBlockingOutage.mockReturnValueOnce(dismissal.promise);
      vi.mocked(checkSkillsOriginHealth).mockResolvedValue({
        status: ServiceHealthStatus.Down,
      });

      const boot = bootstrapProgram(buildSession({ signup }), run, program());
      await vi.waitFor(() =>
        expect(ui.showBlockingOutage).toHaveBeenCalledOnce(),
      );
      expect(authenticate).not.toHaveBeenCalled();
      expect(gatewayAuth).not.toHaveBeenCalled();

      dismissal.resolve();
      await boot;

      expect(checkSkillsOriginHealth).toHaveBeenCalledOnce();
      expect(checkLlmGatewayHealth).toHaveBeenCalledExactlyOnceWith(
        'https://gateway.example.com',
      );
      expect(ui.showBlockingOutage).toHaveBeenCalledOnce();
      expect(wizardAbort).not.toHaveBeenCalled();
    },
  );

  it('does not repeat a cached, dismissed skills warning when the gateway is healthy', async () => {
    const session = buildSession({});
    session.readinessResult = preflight(ServiceHealthStatus.Down);

    await bootstrapProgram(session, run, program());

    expect(checkSkillsOriginHealth).not.toHaveBeenCalled();
    expect(checkLlmGatewayHealth).toHaveBeenCalledOnce();
    expect(ui.showBlockingOutage).not.toHaveBeenCalled();
  });

  it('pauses a new gateway outage, then refreshes credentials and resumes after dismissal', async () => {
    const session = buildSession({});
    session.readinessResult = preflight(ServiceHealthStatus.Down);
    const dismissal = deferred();
    ui.showBlockingOutage.mockReturnValueOnce(dismissal.promise);
    vi.mocked(checkLlmGatewayHealth).mockResolvedValue({
      status: ServiceHealthStatus.NoConnection,
    });
    vi.mocked(refreshAccessTokenIfNeeded)
      .mockResolvedValueOnce()
      .mockImplementationOnce((current) => {
        current.credentials = credentials('refreshed-access-token');
        return Promise.resolve();
      });

    const boot = bootstrapProgram(session, run, program());
    await vi.waitFor(() =>
      expect(ui.showBlockingOutage).toHaveBeenCalledOnce(),
    );
    expect(refreshAccessTokenIfNeeded).toHaveBeenCalledOnce();
    expect(createTriageLLMProvider).not.toHaveBeenCalled();

    dismissal.resolve();
    const result = await boot;

    expect(refreshAccessTokenIfNeeded).toHaveBeenCalledTimes(2);
    expect(wizardAbort).not.toHaveBeenCalled();
    expect(result.credentials.accessToken).toBe('refreshed-access-token');
    const resolveTriageAuth = vi.mocked(createTriageLLMProvider).mock
      .calls[0]?.[0];
    expect(typeof resolveTriageAuth).toBe('function');
    if (typeof resolveTriageAuth !== 'function') {
      throw new Error('Expected a live gateway auth resolver');
    }
    await resolveTriageAuth();
    expect(gatewayAuth).toHaveBeenLastCalledWith(
      result.credentials.host,
      'refreshed-access-token',
      program().id,
    );
  });
});
