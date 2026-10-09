// Behaviour baseline: every ScreenId and Overlay through real Ink at two sizes.
// Every fixture arranges session state until the router resolves to its target,
// so each frame carries the full ScreenContainer chrome. No screen needs a
// bare, router-bypassing render.

import { vi, it, expect, describe, beforeAll, afterEach } from 'vitest';
import { cleanup } from 'ink-testing-library';

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));

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
}));
vi.mock(import('@tui/auth/project-data'), async (actual) => ({
  ...(await actual()),
  getOrAskForProjectData: vi.fn(pending),
}));
vi.mock(
  import('@tui/tools/mcp/services/suggested-prompts'),
  async (actual) => ({
    ...(await actual()),
    createMcpSuggestedPromptsServices: () =>
      ({
        performLogin: pending,
        runPromptStreaming: () => ({
          [Symbol.asyncIterator]: () => ({ next: pending }),
        }),
        probeProjectData: pending,
        seedDemoEvents: pending,
      } as unknown as McpSuggestedPromptsServices),
  }),
);
vi.mock('@shared/api', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  fetchUserData: vi.fn(pending),
  fetchSlackConnected: vi.fn(pending),
  fetchGithubConnected: vi.fn(pending),
}));
vi.mock(import('@shared/skill-install'), async (actual) => ({
  ...(await actual()),
  downloadSkill: vi.fn(pending),
}));
vi.mock('@shared/skill-menu', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  fetchSkillMenu: vi.fn(pending),
}));
vi.mock(import('@programs/self-driving'), async (actual) => ({
  ...(await actual()),
  detectSelfDrivingIntegrationProjects: vi.fn(pending),
}));
vi.mock(import('@programs/error-tracking'), async (actual) => ({
  ...(await actual()),
  detectErrorTrackingProjects: vi.fn(pending),
}));
vi.mock(
  import('@programs/error-tracking-upload-source-maps'),
  async (actual) => ({
    ...(await actual()),
    detectSourceMapsProjects: vi.fn(pending),
  }),
);
vi.mock(import('@tools'), async (actual) => ({
  ...(await actual()),
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

import { WizardStore, type ScreenName } from '@tui/store';
import { TaskStatus } from '@shared/task-status';
import { SkillScreenId } from '@tui/programs/shared/screen-ids';
import { listTuiPrograms } from '@tui/programs/index';
import { listTuiTools } from '@tui/tools/index';
import { ScreenId, Overlay } from '@tui/router';
import { createServices, type ScreenServices } from '@tui/screen-registry';
import { OutroKind } from '@shared/outro';
import { RunPhase, McpOutcome } from '@shared/run-state';
import { HostResolution } from '@shared/host-resolution';
import { Integration } from '@shared/constants';
import {
  FRAMEWORK_REGISTRY,
  buildSession,
  Program,
  type ProgramId,
} from '@programs';
import type { FrameworkConfig } from '@programs/types';
import {
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { ServiceHealthStatus } from '@shared/health-checks/types';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@programs/error-tracking-upload-source-maps';
import { AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS } from '@programs/audit';
import type { McpInstaller } from '@tui/services/mcp-installer';
import type { McpSuggestedPromptsServices } from '@tui/tools/mcp';
import {
  renderScreen,
  screenShell,
  type TerminalSize,
} from './helpers/render-screen.no-jest';
import { AiObservabilityScreenId } from '@tui/programs/ai-observability';
import { AuditScreenId } from '@tui/programs/audit';
import { ErrorTrackingScreenId } from '@tui/programs/error-tracking';
import { McpScreenId } from '@tui/tools/mcp';
import { MetricsScreenId } from '@tui/programs/metrics';
import { MigrationScreenId } from '@tui/programs/migration';
import { PostHogIntegrationScreenId } from '@tui/programs/posthog-integration';
import { WORKFLOW_PROPOSALS_KEY } from '@programs/posthog-integration';
import { PosthogDoctorScreenId } from '@tui/tools/doctor';
import { RevenueAnalyticsScreenId } from '@tui/programs/revenue-analytics';
import { SelfDrivingScreenId } from '@tui/programs/self-driving';
import { SourceMapsScreenId } from '@tui/programs/error-tracking-upload-source-maps';
import { WarehouseSourceScreenId } from '@tui/programs/warehouse-source';
import { Tool } from '@tools';

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

function makeStore(program: ProgramId): WizardStore {
  const store = new WizardStore(program);
  store.version = '0.0.0-test';
  store.session = buildSession({ installDir: '/app' });
  return store;
}

function makeServices(store: WizardStore): ScreenServices {
  return {
    ...createServices(store),
    mcpInstaller: fakeInstaller,
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

const FIXTURES: Record<string, Fixture> = {
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
  [PostHogIntegrationScreenId.Intro]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      s.setFrameworkConfig(Integration.nextjs, staticFrameworkConfig());
      s.setDetectedFramework('Next.js');
      s.setSkillId('nextjs');
      s.setDetectionComplete();
    },
  },
  [RevenueAnalyticsScreenId.Intro]: { program: Program.RevenueAnalyticsSetup },
  [WarehouseSourceScreenId.Intro]: { program: Program.WarehouseSource },
  [SourceMapsScreenId.Intro]: {
    program: Program.ErrorTrackingUploadSourceMaps,
  },
  [SourceMapsScreenId.Detect]: {
    program: Program.ErrorTrackingUploadSourceMaps,
    arrange: (s) => {
      s.completeSetup();
      s.setCredentials(CREDENTIALS);
    },
  },
  [SourceMapsScreenId.Outro]: {
    program: Program.ErrorTrackingUploadSourceMaps,
    arrange: (s) => {
      s.completeSetup();
      s.setCredentials(CREDENTIALS);
      s.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedVariant, 'node');
      s.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath, '.');
      ranSuccessfully(s);
    },
  },
  [MigrationScreenId.Intro]: { program: Program.Migration },
  [SkillScreenId.Intro]: { program: Program.AgentSkill },
  [AiObservabilityScreenId.Intro]: { program: Program.AiObservability },
  [MetricsScreenId.Intro]: { program: Program.Metrics },
  [ErrorTrackingScreenId.Intro]: { program: Program.ErrorTracking },
  [ErrorTrackingScreenId.Detect]: {
    program: Program.ErrorTracking,
    arrange: authed,
  },
  [SelfDrivingScreenId.Intro]: { program: Program.SelfDriving },
  [SelfDrivingScreenId.IntegrationCheck]: {
    program: Program.SelfDriving,
    arrange: (s) => s.completeSetup(),
  },
  [SelfDrivingScreenId.IntegrationDetect]: {
    program: Program.SelfDriving,
    arrange: (s) => {
      s.setIntegrate(true);
      authed(s);
    },
  },
  [SelfDrivingScreenId.Handoff]: {
    program: Program.SelfDriving,
    arrange: (s) => {
      s.setIntegrate(true);
      authed(s);
      s.setFrameworkConfig(Integration.nextjs, staticFrameworkConfig());
      s.completeRunStep('integrate-run');
    },
  },
  [SelfDrivingScreenId.Github]: {
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
  [AuditScreenId.Intro]: { program: Program.Audit },
  [AuditScreenId.Run]: {
    program: Program.Audit,
    arrange: (s) => {
      authed(s);
      s.setFrameworkContext(AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS);
      s.pushStatus('Reviewing autocapture coverage');
    },
  },
  [AuditScreenId.Outro]: {
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
  [PosthogDoctorScreenId.Intro]: { program: Tool.PosthogDoctor },
  [PosthogDoctorScreenId.Report]: {
    program: Tool.PosthogDoctor,
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
  [PostHogIntegrationScreenId.Workflows]: {
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      ranSuccessfully(s);
      s.setOutroDismissed();
      s.setFrameworkContext(WORKFLOW_PROPOSALS_KEY, {
        rejectedCount: 0,
        proposals: [
          {
            title: 'Welcome and first notebook nudge',
            goal: 'activation',
            reason:
              'Welcomes new users and nudges them to create their first notebook.',
            workflow: {},
          },
        ],
      });
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
  [McpScreenId.SuggestedPrompts]: { program: Tool.McpTutorial },
  [ScreenId.SlackConnect]: {
    program: Tool.SlackConnect,
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
  [McpScreenId.Add]: { program: Tool.McpAdd },
  [McpScreenId.Remove]: { program: Tool.McpRemove },
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
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
});

afterEach(cleanup);

// A screen a flow can reach but no fixture renders would go unpinned.
it('has a fixture for every screen and overlay', () => {
  const all: string[] = [
    ...Object.values(ScreenId),
    ...[...listTuiPrograms(), ...listTuiTools()].flatMap((owner) =>
      Object.keys(owner.screens ?? {}),
    ),
    ...Object.values(Overlay),
  ];
  expect(all.filter((screen) => !(screen in FIXTURES))).toEqual([]);
});

describe.each(Object.entries(FIXTURES))('%s', (name, fixture) => {
  it.each(SIZES)(`at $columns x $rows`, async (size) => {
    const screen = name;
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
    const store = makeStore(FIXTURES[PostHogIntegrationScreenId.Intro].program);
    FIXTURES[PostHogIntegrationScreenId.Intro].arrange?.(store);
    const { frame } = await renderScreen(
      store,
      screenShell(store, makeServices(store)),
      TOO_SMALL,
    );
    expect(frame).toContain('needs at least 80×28');
    await expect(frame).toMatchFileSnapshot(
      snapshotPath(PostHogIntegrationScreenId.Intro, TOO_SMALL),
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
    expect(store.currentScreen).toBe(RevenueAnalyticsScreenId.Intro);
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
