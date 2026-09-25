// Behaviour baseline: every ScreenId and Overlay through real Ink at two sizes.
// Every fixture arranges session state until the router resolves to its target,
// so each frame carries the full ScreenContainer chrome. No screen needs a
// bare, router-bypassing render.

import { vi, it, expect, describe, beforeAll, afterEach } from 'vitest';
import { cleanup } from 'ink-testing-library';

vi.mock('ink', () =>
  vi.importActual('../../../../node_modules/ink/build/index.js'),
);

const { pending } = vi.hoisted(() => ({
  pending: () => new Promise<never>(() => undefined),
}));

vi.mock('opn', () => ({ default: vi.fn(pending) }));
vi.mock('@utils/analytics', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));
vi.mock('@utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  openInBrowser: vi.fn().mockResolvedValue(true),
  browserOpenCommands: vi.fn(() => []),
}));
vi.mock('@utils/links', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openTrackedLink: vi.fn(),
}));
vi.mock('@utils/debug', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  getLogFilePath: () => '/tmp/posthog-wizard.log',
  logToFile: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@utils/setup-utils', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  getOrAskForProjectData: vi.fn(pending),
}));
vi.mock('@shared/api', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  fetchUserData: vi.fn(pending),
  fetchSlackConnected: vi.fn(pending),
  fetchGithubConnected: vi.fn(pending),
}));
vi.mock('@agent/tools', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  downloadSkill: vi.fn(pending),
}));
vi.mock('@shared/skill-menu', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  fetchSkillMenu: vi.fn(pending),
}));
vi.mock('@ui/tui/hooks/useGithubConnection', () => ({
  useGithubConnection: () => undefined,
  fetchLoginUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock('@programs/self-driving/detect-agentic', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  detectSelfDrivingIntegrationProjects: vi.fn(pending),
}));
vi.mock('@programs/error-tracking/detect-agentic', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  detectErrorTrackingProjects: vi.fn(pending),
}));
vi.mock(
  '@programs/error-tracking-upload-source-maps/detect-agentic',
  async (actual) => ({
    ...(await actual<Record<string, unknown>>()),
    detectSourceMapsProjects: vi.fn(pending),
  }),
);
vi.mock('@programs/posthog-doctor/fetch', () => ({
  fetchHealthIssues: vi.fn().mockResolvedValue([
    {
      id: 'issue-1',
      kind: 'ingestion_lag',
      severity: 'critical',
      status: 'active',
      dismissed: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'issue-2',
      kind: 'sdk_outdated',
      severity: 'warning',
      status: 'active',
      dismissed: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ]),
}));

import { WizardStore, TaskStatus, type ScreenName } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { ScreenId, Overlay } from '@ui/tui/router';
import { createServices, type ScreenServices } from '@ui/tui/screen-registry';
import {
  buildSession,
  OutroKind,
  RunPhase,
  McpOutcome,
} from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { Integration } from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@programs/frameworks/registry';
import type { FrameworkConfig } from '@programs/types';
import { Program, type ProgramId } from '@programs';
import {
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { ServiceHealthStatus } from '@shared/health-checks/types';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@programs/error-tracking-upload-source-maps/detect';
import { AUDIT_CHECKS_KEY } from '@programs/audit/types';
import { AUDIT_SEED_CHECKS } from '@programs/audit/seed';
import type { McpInstaller } from '@ui/tui/services/mcp-installer';
import type { McpSuggestedPromptsServices } from '@ui/tui/services/mcp-suggested-prompts-services';
import {
  renderScreen,
  screenShell,
  type TerminalSize,
} from './helpers/render-screen.no-jest';

// 80x28 is the ScreenContainer minimum. Anything smaller renders the
// viewport guard instead of the screen, which the last describe pins once.
const SIZES: TerminalSize[] = [
  { columns: 120, rows: 40 },
  { columns: 80, rows: 28 },
];
const TOO_SMALL: TerminalSize = { columns: 60, rows: 15 };

const CREDENTIALS = {
  accessToken: 'phx_test_token',
  projectApiKey: 'phc_test_key',
  host: HostResolution.fromApiHost('https://us.posthog.com'),
  projectId: 42,
};

const HEALTHY: WizardReadinessResult = {
  decision: WizardReadiness.Yes,
  health: { skillsOrigin: { status: ServiceHealthStatus.Healthy } },
  reasons: [],
};

const OUTAGE: WizardReadinessResult = {
  decision: WizardReadiness.No,
  health: { skillsOrigin: { status: ServiceHealthStatus.Down } },
  reasons: ['Skill downloads are unavailable.'],
};

const SUCCESS_OUTRO = {
  kind: OutroKind.Success,
  message: 'PostHog is set up!',
  body: 'Events will start flowing once you run the app.',
  changes: ['Added posthog-js', 'Wired the provider'],
  reportFile: 'posthog-setup-report.md',
  docsUrl: 'https://posthog.com/docs',
};

/** Next.js config with its setup question stubbed so detection never touches disk. */
function staticFrameworkConfig(): FrameworkConfig {
  const base = FRAMEWORK_REGISTRY[Integration.nextjs];
  const setup = base.metadata.setup;
  if (!setup) return base;
  return {
    ...base,
    metadata: {
      ...base.metadata,
      setup: {
        ...setup,
        questions: setup.questions.map((q) => ({
          ...q,
          detect: () => Promise.resolve(null),
        })),
      },
    },
  };
}

const fakeInstaller: McpInstaller = {
  detectClients: () =>
    Promise.resolve([
      { name: 'Claude Code', supportsPlugin: true, pluginBundlesMcp: false },
      { name: 'Cursor', supportsPlugin: false, pluginBundlesMcp: false },
    ]),
  install: pending,
  remove: pending,
  installPlugins: pending,
};

const inertPromptsServices = {
  performLogin: pending,
  runPromptStreaming: () => ({
    [Symbol.asyncIterator]: () => ({ next: pending }),
  }),
  probeProjectData: pending,
  seedDemoEvents: pending,
} as unknown as McpSuggestedPromptsServices;

function makeStore(program: ProgramId): WizardStore {
  const store = new WizardStore(program);
  setUI(new InkUI(store));
  store.version = '0.0.0-test';
  store.session = buildSession({ installDir: '/app' });
  return store;
}

function makeServices(store: WizardStore): ScreenServices {
  return {
    ...createServices(store),
    mcpInstaller: fakeInstaller,
    mcpSuggestedPromptsServices: inertPromptsServices,
  };
}

function authed(store: WizardStore): void {
  store.completeSetup();
  store.setReadinessResult(HEALTHY);
  store.setCredentials(CREDENTIALS);
}

function ranSuccessfully(store: WizardStore): void {
  store.setRunPhase(RunPhase.Completed);
  store.setOutroData(SUCCESS_OUTRO);
}

interface Fixture {
  program: ProgramId;
  arrange?: (store: WizardStore) => void;
}

const FIXTURES: Record<ScreenName, Fixture> = {
  // ── Overlays ───────────────────────────────────────────────────
  [Overlay.SettingsOverride]: {
    program: Program.PostHogIntegration,
    arrange: (s) =>
      void s.showSettingsOverride(
        [
          {
            source: 'project',
            path: '/app/.claude/settings.json',
            keys: ['ANTHROPIC_BASE_URL', 'apiKeyHelper'],
            writable: true,
          },
        ],
        () => true,
      ),
  },
  [Overlay.ManagedSettings]: {
    program: Program.PostHogIntegration,
    arrange: (s) =>
      void s.showSettingsOverride(
        [
          {
            source: 'managed',
            path: '/Library/Application Support/ClaudeCode/managed-settings.json',
            keys: ['ANTHROPIC_BASE_URL'],
            writable: false,
          },
        ],
        () => true,
      ),
  },
  [Overlay.PortConflict]: {
    program: Program.PostHogIntegration,
    arrange: (s) =>
      void s.showPortConflict({
        command: 'node',
        pid: '4242',
        port: 8010,
        user: 'wizard',
      }),
  },
  [Overlay.TaskNotice]: {
    program: Program.PostHogIntegration,
    arrange: (s) =>
      void s.showTaskNotice({
        title: 'Connect your data sources',
        body: ['We detected warehouse sources in this project.'],
        items: ['Postgres', 'Stripe'],
        confirmLabel: 'Continue [Enter]',
        cancelLabel: 'Skip [Esc]',
        prompt: 'Connect these during setup?',
      }),
  },
  [Overlay.ManualAuthCode]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      s.completeSetup();
      s.setReadinessResult(HEALTHY);
      s.showManualAuthCode();
    },
  },
  [Overlay.AuthError]: {
    program: Program.PostHogIntegration,
    arrange: (s) =>
      s.showAuthError({
        hasSettingsConflict: true,
        conflicts: [
          {
            source: 'project',
            path: '/app/.claude/settings.json',
            keys: ['ANTHROPIC_BASE_URL'],
            writable: true,
          },
        ],
        credentialPlaces: ['ANTHROPIC_API_KEY in your shell profile'],
        logFilePath: '/tmp/posthog-wizard.log',
      }),
  },
  [Overlay.SessionTimeout]: {
    program: Program.PostHogIntegration,
    arrange: (s) => s.showSessionTimeout(),
  },
  [Overlay.WizardAsk]: {
    program: Program.PostHogIntegration,
    arrange: (s) =>
      void s.requestQuestion({
        id: 'q1',
        source: 'integration-nextjs',
        questions: [
          {
            id: 'router',
            prompt: 'Which router does this app use?',
            kind: 'single',
            options: [
              { label: 'App Router', value: 'app' },
              { label: 'Pages Router', value: 'pages' },
            ],
          },
        ],
      }),
  },

  // ── Program screens ────────────────────────────────────────────
  [ScreenId.Intro]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      s.setFrameworkConfig(Integration.nextjs, staticFrameworkConfig());
      s.setDetectedFramework('Next.js');
      s.setSkillId('nextjs');
      s.setDetectionComplete();
    },
  },
  [ScreenId.RevenueIntro]: { program: Program.RevenueAnalyticsSetup },
  [ScreenId.WarehouseIntro]: { program: Program.WarehouseSource },
  [ScreenId.SourceMapsIntro]: {
    program: Program.ErrorTrackingUploadSourceMaps,
  },
  [ScreenId.SourceMapsDetect]: {
    program: Program.ErrorTrackingUploadSourceMaps,
    arrange: (s) => {
      s.completeSetup();
      s.setCredentials(CREDENTIALS);
    },
  },
  [ScreenId.SourceMapsOutro]: {
    program: Program.ErrorTrackingUploadSourceMaps,
    arrange: (s) => {
      s.completeSetup();
      s.setCredentials(CREDENTIALS);
      s.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedVariant, 'node');
      s.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath, '.');
      ranSuccessfully(s);
    },
  },
  [ScreenId.MigrationIntro]: { program: Program.Migration },
  [ScreenId.AgentSkillIntro]: { program: Program.AgentSkill },
  [ScreenId.AiObservabilityIntro]: { program: Program.AiObservability },
  [ScreenId.MetricsIntro]: { program: Program.Metrics },
  [ScreenId.ErrorTrackingIntro]: { program: Program.ErrorTracking },
  [ScreenId.ErrorTrackingDetect]: {
    program: Program.ErrorTracking,
    arrange: authed,
  },
  [ScreenId.SelfDrivingIntro]: { program: Program.SelfDriving },
  [ScreenId.SelfDrivingIntegrationCheck]: {
    program: Program.SelfDriving,
    arrange: (s) => s.completeSetup(),
  },
  [ScreenId.SelfDrivingIntegrationDetect]: {
    program: Program.SelfDriving,
    arrange: (s) => {
      s.setIntegrate(true);
      authed(s);
    },
  },
  [ScreenId.SelfDrivingHandoff]: {
    program: Program.SelfDriving,
    arrange: (s) => {
      s.setIntegrate(true);
      authed(s);
      s.setFrameworkConfig(Integration.nextjs, staticFrameworkConfig());
      s.completeRunStep('integrate-run');
    },
  },
  [ScreenId.SelfDrivingGithub]: {
    program: Program.SelfDriving,
    arrange: (s) => {
      s.setIntegrate(true);
      authed(s);
      s.setFrameworkConfig(Integration.nextjs, staticFrameworkConfig());
      s.completeRunStep('integrate-run');
      s.confirmSelfDrivingHandoff();
      s.setGithubConnected(false);
    },
  },
  [ScreenId.AuditIntro]: { program: Program.Audit },
  [ScreenId.AuditRun]: {
    program: Program.Audit,
    arrange: (s) => {
      authed(s);
      s.setFrameworkContext(AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS);
      s.pushStatus('Reviewing autocapture coverage');
    },
  },
  [ScreenId.AuditOutro]: {
    program: Program.Audit,
    arrange: (s) => {
      authed(s);
      s.setFrameworkContext(AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS);
      ranSuccessfully(s);
    },
  },
  [ScreenId.HealthCheck]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      s.completeSetup();
      s.setReadinessResult(OUTAGE);
    },
  },
  [ScreenId.DoctorIntro]: { program: Program.PosthogDoctor },
  [ScreenId.DoctorReport]: {
    program: Program.PosthogDoctor,
    arrange: authed,
  },
  [ScreenId.Setup]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      s.setFrameworkConfig(Integration.nextjs, staticFrameworkConfig());
      s.completeSetup();
      s.setReadinessResult(HEALTHY);
    },
  },
  [ScreenId.Auth]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      s.completeSetup();
      s.setReadinessResult(HEALTHY);
      s.setLoginUrl('https://us.posthog.com/login?next=/oauth/authorize');
    },
  },
  [ScreenId.AiOptIn]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      s.setApiUser(apiUser(false));
    },
  },
  [ScreenId.Run]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      s.setRunPhase(RunPhase.Running);
      s.syncTodos([
        { content: 'Install posthog-js', status: TaskStatus.Completed },
        {
          content: 'Wire the provider',
          status: TaskStatus.InProgress,
          activeForm: 'Wiring the provider',
        },
        { content: 'Capture a test event', status: TaskStatus.Pending },
      ]);
      s.setEventPlan([
        { name: 'signup_completed', description: 'A new account was created' },
      ]);
      s.pushStatus('Editing app/layout.tsx');
    },
  },
  [ScreenId.Mcp]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      ranSuccessfully(s);
      s.setOutroDismissed();
    },
  },
  [ScreenId.McpSuggestedPrompts]: { program: Program.McpTutorial },
  [ScreenId.SlackConnect]: {
    program: Program.SlackConnect,
    arrange: (s) => {
      s.setCredentials(CREDENTIALS);
      s.setSlackConnected(false);
    },
  },
  [ScreenId.KeepSkills]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      ranSuccessfully(s);
      s.setOutroDismissed();
      s.setMcpComplete(McpOutcome.Skipped);
      s.setSlackStepDismissed();
    },
  },
  [ScreenId.Outro]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      ranSuccessfully(s);
      s.setDashboardUrl('https://us.posthog.com/project/42/dashboard/7');
    },
  },
  [ScreenId.MintFailure]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      s.setRunPhase(RunPhase.Error);
      s.setOutroData({
        kind: OutroKind.Error,
        message: 'The agent run failed',
      });
    },
  },
  [ScreenId.Exit]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      s.setRunPhase(RunPhase.Error);
      s.setOutroData({
        kind: OutroKind.Error,
        message: 'The agent run failed',
      });
      s.setMintHandoff('exit');
    },
  },
  [ScreenId.McpAdd]: { program: Program.McpAdd },
  [ScreenId.McpRemove]: { program: Program.McpRemove },
};

/** Only the org's AI consent and membership level drive the gate screen. */
function apiUser(approved: boolean): WizardStore['session']['apiUser'] {
  return {
    distinct_id: 'user-1',
    team: { id: 42, organization: '00000000-0000-0000-0000-000000000000' },
    organization: {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Hedgehogs Inc',
      membership_level: 8,
      is_ai_data_processing_approved: approved,
    },
  } as unknown as WizardStore['session']['apiUser'];
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
});

afterEach(cleanup);

describe.each(Object.entries(FIXTURES))('%s', (name, fixture) => {
  it.each(SIZES)(`at $columns x $rows`, async (size) => {
    const screen = name as ScreenName;
    const store = makeStore(fixture.program);
    fixture.arrange?.(store);
    expect(store.currentScreen).toBe(screen);

    const { frame } = await renderScreen(
      store,
      screenShell(store, makeServices(store)),
      size,
    );
    await expect(frame).toMatchFileSnapshot(snapshotPath(screen, size));
  });
});

describe('viewport guard', () => {
  it('replaces every screen below 80x28 with the too-small message', async () => {
    const store = makeStore(FIXTURES[ScreenId.Intro].program);
    FIXTURES[ScreenId.Intro].arrange?.(store);
    const { frame } = await renderScreen(
      store,
      screenShell(store, makeServices(store)),
      TOO_SMALL,
    );
    expect(frame).toContain('needs at least 80×28');
    await expect(frame).toMatchFileSnapshot(
      snapshotPath(ScreenId.Intro, TOO_SMALL),
    );
  });
});

describe('revenue-intro with a detect error', () => {
  // Covers the detect-error branch of RevenueIntroScreen, which spreads the
  // POSTHOG_SDKS / STRIPE_SDKS sets before calling array methods.
  it.each(SIZES)(`at $columns x $rows`, async (size) => {
    const store = makeStore(Program.RevenueAnalyticsSetup);
    store.setFrameworkContext('detectError', {
      kind: 'no-sdks',
      scannedCount: 2,
    });
    expect(store.currentScreen).toBe(ScreenId.RevenueIntro);
    const { frame } = await renderScreen(
      store,
      screenShell(store, makeServices(store)),
      size,
    );
    await expect(frame).toMatchFileSnapshot(
      `__snapshots__/frames/revenue-intro-detect-error-${size.columns}x${size.rows}.txt`,
    );
  });
});

function snapshotPath(screen: ScreenName, size: TerminalSize): string {
  return `__snapshots__/frames/${screen}-${size.columns}x${size.rows}.txt`;
}
