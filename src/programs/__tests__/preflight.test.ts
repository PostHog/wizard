import {
  backupAndFixClaudeSettings,
  checkAllSettingsConflicts,
  restoreClaudeSettings,
  type SettingsConflict,
} from '@shared/claude-settings';
import { ErrorCodes } from '@shared/errors';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { ServiceHealthStatus } from '@shared/health-checks/types';
import { analytics } from '@utils/analytics';
import { PROGRAM_REGISTRY } from '../program-registry';
import {
  HEALTH_CHECK_PROGRAMS,
  preflight,
  type ProgramPreflightHost,
} from '../preflight';

vi.mock('@utils/debug');
vi.mock('@shared/health-checks/readiness', async (original) => ({
  ...(await original<typeof import('@shared/health-checks/readiness')>()),
  evaluateWizardReadiness: vi.fn(),
}));
vi.mock('@shared/claude-settings', async (original) => ({
  ...(await original<typeof import('@shared/claude-settings')>()),
  checkAllSettingsConflicts: vi.fn(),
  backupAndFixClaudeSettings: vi.fn(),
  restoreClaudeSettings: vi.fn(),
}));

const INSTALL_DIR = '/tmp/preflight-test';

const outage: WizardReadinessResult = {
  decision: WizardReadiness.No,
  health: { skillsOrigin: { status: ServiceHealthStatus.Down } },
  reasons: ['Skills download: down'],
};
const warnings: WizardReadinessResult = {
  decision: WizardReadiness.YesWithWarnings,
  health: { skillsOrigin: { status: ServiceHealthStatus.Degraded } },
  reasons: ['Skills download: degraded'],
};
const managedConflict: SettingsConflict = {
  source: 'managed',
  path: '/etc/claude-code/managed-settings.json',
  keys: ['apiKeyHelper'],
  writable: false,
};
const projectConflict: SettingsConflict = {
  source: 'project',
  path: `${INSTALL_DIR}/.claude/settings.json`,
  keys: ['ANTHROPIC_BASE_URL'],
  writable: true,
};

const calls: string[] = [];

function host(overrides: Partial<ProgramPreflightHost> = {}) {
  return {
    installDir: INSTALL_DIR,
    signup: false,
    interactive: false,
    readiness: null,
    showOutage: vi.fn(() => {
      calls.push('showOutage');
      return Promise.resolve();
    }),
    setReadinessWarnings: vi.fn(() => {
      calls.push('setReadinessWarnings');
    }),
    showSettingsOverride: vi.fn(() => {
      calls.push('showSettingsOverride');
      return Promise.resolve();
    }),
    ...overrides,
  } satisfies ProgramPreflightHost;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.spyOn(analytics, 'wizardCapture').mockImplementation(() => undefined);
  vi.mocked(evaluateWizardReadiness).mockImplementation(() => {
    calls.push('evaluateWizardReadiness');
    return Promise.resolve({
      decision: WizardReadiness.Yes,
      health: { skillsOrigin: { status: ServiceHealthStatus.Healthy } },
      reasons: [],
    });
  });
  vi.mocked(checkAllSettingsConflicts).mockImplementation(() => {
    calls.push('checkAllSettingsConflicts');
    return [];
  });
});

it.each([
  ['a program without a health check', 'warehouse-source', null],
  ['a readiness the host already computed', 'metrics', warnings],
] as const)('skips readiness for %s', async (_case, programId, readiness) => {
  const preflightHost = host({ readiness });

  const decision = await preflight(programId, preflightHost);

  expect(evaluateWizardReadiness).not.toHaveBeenCalled();
  expect(preflightHost.showOutage).not.toHaveBeenCalled();
  expect(preflightHost.setReadinessWarnings).not.toHaveBeenCalled();
  expect(calls).toEqual(['checkAllSettingsConflicts']);
  expect(decision.kind).toBe('proceed');
});

it('shows an interactive outage, then aborts with EnvServiceOutage and skips the settings check', async () => {
  vi.mocked(evaluateWizardReadiness).mockImplementation(() => {
    calls.push('evaluateWizardReadiness');
    return Promise.resolve(outage);
  });
  const preflightHost = host({ interactive: true });

  const decision = await preflight('posthog-integration', preflightHost);

  expect(preflightHost.showOutage).toHaveBeenCalledExactlyOnceWith(outage);
  expect(calls).toEqual(['evaluateWizardReadiness', 'showOutage']);
  expect(decision).toEqual({
    kind: 'abort',
    failure: {
      code: ErrorCodes.EnvServiceOutage,
      message:
        'Cannot start — external services are down:\n' +
        '  - Skills download (down)\n' +
        '\nPlease try again later.',
    },
  });
});

it('shows a non-interactive outage and proceeds to the settings check', async () => {
  vi.mocked(evaluateWizardReadiness).mockImplementation(() => {
    calls.push('evaluateWizardReadiness');
    return Promise.resolve(outage);
  });
  const preflightHost = host({ interactive: false });

  const decision = await preflight('posthog-integration', preflightHost);

  expect(preflightHost.showOutage).toHaveBeenCalledExactlyOnceWith(outage);
  expect(calls).toEqual([
    'evaluateWizardReadiness',
    'showOutage',
    'checkAllSettingsConflicts',
  ]);
  expect(decision.kind).toBe('proceed');
  if (decision.kind !== 'proceed') return;
  expect(restoreClaudeSettings).not.toHaveBeenCalled();
  decision.restoreSettings();
  expect(restoreClaudeSettings).toHaveBeenCalledExactlyOnceWith(INSTALL_DIR);
});

it('sends readiness warnings to setReadinessWarnings and proceeds', async () => {
  vi.mocked(evaluateWizardReadiness).mockImplementation(() => {
    calls.push('evaluateWizardReadiness');
    return Promise.resolve(warnings);
  });
  const preflightHost = host({ interactive: true });

  const decision = await preflight('metrics', preflightHost);

  expect(preflightHost.setReadinessWarnings).toHaveBeenCalledExactlyOnceWith(
    warnings,
  );
  expect(preflightHost.showOutage).not.toHaveBeenCalled();
  expect(calls).toEqual([
    'evaluateWizardReadiness',
    'setReadinessWarnings',
    'checkAllSettingsConflicts',
  ]);
  expect(decision.kind).toBe('proceed');
});

it.each([
  [
    'an org-managed conflict',
    [managedConflict],
    false,
    '  - managed (/etc/claude-code/managed-settings.json): apiKeyHelper',
  ],
  [
    'a project conflict whose backup fails',
    [projectConflict],
    false,
    `  - project (${INSTALL_DIR}/.claude/settings.json): ANTHROPIC_BASE_URL`,
  ],
] as const)(
  'aborts a non-interactive run on %s with SettingsUnfixableConflict before any override',
  async (_case, conflicts, backedUp, line) => {
    vi.mocked(checkAllSettingsConflicts).mockReturnValue([...conflicts]);
    vi.mocked(backupAndFixClaudeSettings).mockReturnValue(backedUp);
    const preflightHost = host({ interactive: false });

    const decision = await preflight('warehouse-source', preflightHost);

    expect(preflightHost.showSettingsOverride).not.toHaveBeenCalled();
    expect(decision).toEqual({
      kind: 'abort',
      failure: {
        code: ErrorCodes.SettingsUnfixableConflict,
        message:
          'Cannot start — a Claude settings file redirects the agent away ' +
          'from the PostHog gateway and cannot be neutralized automatically:\n' +
          `${line}\n` +
          '\nRemove the conflicting keys and re-run the wizard.',
      },
    });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'settings conflict detected',
      {
        level: conflicts[0].source === 'managed' ? 'org' : 'project',
        keys: conflicts[0].keys,
      },
    );
  },
);

it('awaits the settings override for an interactive unfixable conflict', async () => {
  vi.mocked(checkAllSettingsConflicts).mockReturnValue([managedConflict]);
  let resolveOverride!: () => void;
  const preflightHost = host({
    interactive: true,
    showSettingsOverride: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOverride = resolve;
        }),
    ),
  });

  let settled = false;
  const pending = preflight('warehouse-source', preflightHost).then(
    (decision) => {
      settled = true;
      return decision;
    },
  );
  await vi.waitFor(() =>
    expect(preflightHost.showSettingsOverride).toHaveBeenCalledOnce(),
  );
  await Promise.resolve();
  expect(settled).toBe(false);

  const [conflicts, fix] = vi.mocked(preflightHost.showSettingsOverride).mock
    .calls[0];
  expect(conflicts).toEqual([managedConflict]);
  vi.mocked(backupAndFixClaudeSettings).mockReturnValue(true);
  expect(fix()).toBe(true);
  expect(backupAndFixClaudeSettings).toHaveBeenCalledExactlyOnceWith(
    INSTALL_DIR,
  );

  resolveOverride();
  expect((await pending).kind).toBe('proceed');
});

it('lists every registered program whose steps include the health-check screen', () => {
  const withHealthCheck = PROGRAM_REGISTRY.filter((config) =>
    config.steps.some((step) => step.screenId === 'health-check'),
  ).map((config) => config.id);

  expect([...HEALTH_CHECK_PROGRAMS].sort()).toEqual(withHealthCheck.sort());
});
