/**
 * Every screen exit: drive the real screen by keyboard to its exit and assert
 * the code it asks the host to end the run with, the code the CLI exits with.
 */
import { vi, it, expect, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock(import('ink'), () =>
  vi.importActual<typeof import('ink')>('ink-actual'),
);

const { pending } = vi.hoisted(() => ({
  pending: () => new Promise<never>(() => undefined),
}));

vi.mock(import('opn'), () => ({ default: vi.fn(pending) }));
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as never,
  sessionProperties: vi.fn(() => ({})),
}));
vi.mock(import('@utils/clipboard'), () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  openInBrowser: vi.fn().mockResolvedValue(true),
  browserOpenCommands: vi.fn(() => []),
}));
vi.mock(import('@utils/links'), async (actual) => ({
  ...(await actual()),
  openTrackedLink: vi.fn(),
}));
vi.mock(import('@tui/auth/project-data'), async (actual) => ({
  ...(await actual()),
  getOrAskForProjectData: vi.fn(pending),
}));
vi.mock(import('@shared/api'), async (actual) => ({
  ...(await actual()),
  fetchUserData: vi.fn(pending),
  fetchSlackConnected: vi.fn(pending),
  fetchGithubConnected: vi.fn(pending),
}));
vi.mock(import('@shared/skill-install'), async (actual) => ({
  ...(await actual()),
  downloadSkill: vi.fn(pending),
}));
vi.mock(import('@shared/skill-menu'), async (actual) => ({
  ...(await actual()),
  fetchSkillMenu: vi.fn().mockResolvedValue(null),
}));
vi.mock(import('@host/wizard-abort'), async (actual) => ({
  ...(await actual()),
  wizardAbort: vi.fn(pending),
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

import { WizardStore } from '@tui/store';
import type { WizardSession } from '@programs/types';
import { ScreenId, Overlay } from '@tui/router';
import { ScreenContainer } from '@tui/primitives/ScreenContainer';
import { createScreens, createServices } from '@tui/screen-registry';
import { OutroKind } from '@shared/outro';
import { McpOutcome, RunPhase } from '@shared/run-state';
import { HostResolution } from '@shared/host-resolution';
import { Integration } from '@shared/constants';
import {
  FRAMEWORK_REGISTRY,
  buildSession,
  Program,
  type ProgramId,
} from '@programs';
import {
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { ServiceHealthStatus } from '@shared/health-checks/types';
import { detectErrorTrackingProjects } from '@programs/error-tracking';
import { detectSourceMapsProjects } from '@programs/error-tracking-upload-source-maps';
import { detectSelfDrivingIntegrationProjects } from '@programs/self-driving';
import { AiObservabilityScreenId } from '@tui/programs/ai-observability';
import { AuditScreenId } from '@tui/programs/audit';
import { ErrorTrackingScreenId } from '@tui/programs/error-tracking';
import { MetricsScreenId } from '@tui/programs/metrics';
import { MigrationScreenId } from '@tui/programs/migration';
import { PostHogIntegrationScreenId } from '@tui/programs/posthog-integration';
import { PosthogDoctorScreenId } from '@tui/tools/doctor';
import { RevenueAnalyticsScreenId } from '@tui/programs/revenue-analytics';
import { SelfDrivingScreenId } from '@tui/programs/self-driving';
import { SkillScreenId } from '@tui/programs/shared/screen-ids';
import { SourceMapsScreenId } from '@tui/programs/error-tracking-upload-source-maps';
import { WarehouseSourceScreenId } from '@tui/programs/warehouse-source';
import { toFrameText } from './helpers/render-screen.no-jest';
import { Tool } from '@tools';
import { applySetter } from '@tui/__tests__/helpers/apply-setter.no-jest';

// KeepSkills reads `<installDir>/.claude/skills`, so never a host directory.
const INSTALL_DIR = mkdtempSync(join(tmpdir(), 'wizard-exits-'));

const ENTER = '\r';
const ESC = '\u001B';
const DOWN = '\u001B[B';
// Real timers: Ink delivers stdin writes through the event loop.
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const HEALTHY: WizardReadinessResult = {
  decision: WizardReadiness.Yes,
  health: { skillsOrigin: { status: ServiceHealthStatus.Healthy } },
  reasons: [],
};

const authed = (s: WizardStore): void => {
  s.completeSetup();
  s.setReadinessResult(HEALTHY);
  s.setCredentials({
    accessToken: 'phx_test',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 1,
  });
};

const ranSuccessfully = (s: WizardStore): void => {
  authed(s);
  s.setRunPhase(RunPhase.Completed);
  s.setOutroData({ kind: OutroKind.Success, message: 'done' });
  s.setOutroDismissed();
  s.setMcpComplete(McpOutcome.Skipped);
  s.setSlackStepDismissed();
};

const runFailed = (s: WizardStore): void => {
  authed(s);
  s.setRunPhase(RunPhase.Error);
  s.setOutroData({ kind: OutroKind.Error, message: 'The agent run failed' });
};

const withNextjs = (s: WizardStore): void => {
  s.setFrameworkConfig(
    Integration.nextjs,
    FRAMEWORK_REGISTRY[Integration.nextjs],
  );
  s.setDetectedFramework('Next.js');
  s.setDetectionComplete();
};

const unapprovedUser = {
  distinct_id: 'user-1',
  organization: {
    membership_level: 8,
    is_ai_data_processing_approved: false,
  },
} as unknown as WizardSession['apiUser'];

const project = (instrumentable: boolean) => ({
  path: '.',
  framework: 'Next.js',
  integration: instrumentable ? Integration.nextjs : null,
  variant: instrumentable ? 'nextjs' : null,
  hasPostHog: instrumentable,
  instrumentable,
  continuable: false,
});

/** Detection fails, finds nothing to set up, or finds one project. */
const detected = (
  detect: (...args: never[]) => unknown,
  result: 'fails' | 'nothing' | 'one',
): void => {
  const mock = vi.mocked(detect);
  if (result === 'fails') mock.mockRejectedValue(new Error('scan failed'));
  else
    mock.mockResolvedValue({
      repoType: 'single',
      projects: [project(result === 'one')],
    } as never);
};

/** Move the picker's focus to `label`, then select it. */
type Key = string | { pick: string };

interface Row {
  name: string;
  program: ProgramId;
  arrange?: (s: WizardStore) => void;
  screen: string;
  keys: Key[];
  /** The code the screen asks to end with; null when it leaves the end to the host. */
  code: number | null;
}

const ROWS: Row[] = [
  // ── Overlays and shared screens ─────────────────────────────────
  {
    name: 'session timeout: any key',
    program: Program.PostHogIntegration,
    arrange: (s) => s.showSessionTimeout(),
    screen: Overlay.SessionTimeout,
    keys: [ENTER],
    code: 1,
  },
  {
    name: 'auth error: any key',
    program: Program.PostHogIntegration,
    arrange: (s) =>
      s.showAuthError({ hasSettingsConflict: false, logFilePath: '/tmp/log' }),
    screen: Overlay.AuthError,
    keys: [ENTER],
    code: 1,
  },
  {
    name: 'settings override: exit',
    program: Program.PostHogIntegration,
    arrange: (s) =>
      void s.showSettingsOverride(
        [
          {
            source: 'project',
            path: '/app/s.json',
            keys: ['K'],
            writable: true,
          },
        ],
        () => true,
      ),
    screen: Overlay.SettingsOverride,
    keys: [ESC],
    code: 1,
  },
  ...[ENTER, ESC].map((key) => ({
    name: `managed settings: ${key === ENTER ? 'enter' : 'exit'}`,
    program: Program.PostHogIntegration,
    arrange: (s: WizardStore) =>
      void s.showSettingsOverride(
        [{ source: 'managed', path: '/m.json', keys: ['K'], writable: false }],
        () => true,
      ),
    screen: Overlay.ManagedSettings,
    keys: [key],
    code: 1,
  })),
  {
    name: 'port conflict: exit',
    program: Program.PostHogIntegration,
    arrange: (s) =>
      void s.showPortConflict({
        command: 'node',
        pid: '1',
        port: 8010,
        user: 'me',
      }),
    screen: Overlay.PortConflict,
    keys: [ESC],
    code: 1,
  },
  {
    name: 'ai opt-in required: exit',
    program: Program.PostHogIntegration,
    arrange: (s) => {
      authed(s);
      s.setApiUser(unapprovedUser);
    },
    screen: ScreenId.AiOptIn,
    keys: ['e'],
    code: 0,
  },
  {
    name: 'exit screen at the end of a flow',
    program: Tool.McpRemove,
    arrange: (s) => s.setMcpComplete(McpOutcome.Skipped),
    screen: ScreenId.Exit,
    keys: [],
    code: 0,
  },
  {
    name: 'exit screen after the mint handoff exits',
    program: Program.PostHogIntegration,
    arrange: (s) => {
      runFailed(s);
      s.setMintHandoff('exit');
    },
    screen: ScreenId.Exit,
    keys: [],
    code: null,
  },
  {
    name: 'keep skills with no skills after a success',
    program: Program.PostHogIntegration,
    arrange: ranSuccessfully,
    screen: ScreenId.KeepSkills,
    keys: [],
    code: 0,
  },
  {
    name: 'keep skills after the mint handoff continues',
    program: Program.PostHogIntegration,
    arrange: (s) => {
      runFailed(s);
      s.setMintHandoff('continue');
      s.setMcpComplete(McpOutcome.Skipped);
      s.setSlackStepDismissed();
    },
    screen: ScreenId.KeepSkills,
    keys: [],
    code: null,
  },

  // ── Program intros ──────────────────────────────────────────────
  {
    name: 'posthog-integration intro: cancel',
    program: Program.PostHogIntegration,
    arrange: withNextjs,
    screen: PostHogIntegrationScreenId.Intro,
    keys: [{ pick: 'Cancel' }],
    code: 0,
  },
  {
    name: 'posthog-integration intro: unsupported version, exit',
    program: Program.PostHogIntegration,
    arrange: (s) => {
      withNextjs(s);
      s.setUnsupportedVersion({
        current: '12.0.0',
        minimum: '13.0.0',
        docsUrl: 'https://posthog.com/docs',
      });
    },
    screen: PostHogIntegrationScreenId.Intro,
    keys: [{ pick: 'Exit' }],
    code: 0,
  },
  ...(
    [
      [Program.Migration, MigrationScreenId.Intro],
      [Program.AiObservability, AiObservabilityScreenId.Intro],
      [Program.Metrics, MetricsScreenId.Intro],
      [Program.Audit, AuditScreenId.Intro],
      [Program.AgentSkill, SkillScreenId.Intro],
      [Tool.PosthogDoctor, PosthogDoctorScreenId.Intro],
      [Program.ErrorTracking, ErrorTrackingScreenId.Intro],
      [Program.ErrorTrackingUploadSourceMaps, SourceMapsScreenId.Intro],
      [Program.RevenueAnalyticsSetup, RevenueAnalyticsScreenId.Intro],
      [Program.WarehouseSource, WarehouseSourceScreenId.Intro],
      [Program.SelfDriving, SelfDrivingScreenId.Intro],
    ] as const
  ).map(([program, screen]) => ({
    name: `${screen}: cancel`,
    program,
    screen,
    keys: [{ pick: 'Cancel' }],
    code: 0,
  })),
  {
    name: 'revenue intro: detect error, exit',
    program: Program.RevenueAnalyticsSetup,
    arrange: (s) =>
      s.setFrameworkContext('detectError', { kind: 'no-package-json' }),
    screen: RevenueAnalyticsScreenId.Intro,
    keys: [{ pick: 'Exit' }],
    code: 1,
  },
  {
    name: 'warehouse intro: detect error, exit',
    program: Program.WarehouseSource,
    arrange: (s) =>
      s.setFrameworkContext('detectError', { kind: 'no-sources' }),
    screen: WarehouseSourceScreenId.Intro,
    keys: [{ pick: 'Exit' }],
    code: 0,
  },
  {
    name: 'self-driving intro: detect error, exit',
    program: Program.SelfDriving,
    arrange: (s) =>
      s.setFrameworkContext('detectError', {
        kind: 'bad-directory',
        path: '/missing',
        reason: 'missing',
      }),
    screen: SelfDrivingScreenId.Intro,
    keys: [{ pick: 'Exit' }],
    code: 1,
  },

  // ── Detection pickers ───────────────────────────────────────────
  ...(
    [
      ['fails', 'Exit', 1],
      ['nothing', 'Exit', 0],
      ['one', 'Cancel', 0],
    ] as const
  ).flatMap(([result, label, code]) => [
    {
      name: `error-tracking detect ${result}: ${label}`,
      program: Program.ErrorTracking,
      arrange: (s: WizardStore) => {
        detected(detectErrorTrackingProjects, result);
        authed(s);
      },
      screen: ErrorTrackingScreenId.Detect,
      keys: [{ pick: label }],
      code,
    },
    {
      name: `source-maps detect ${result}: ${label}`,
      program: Program.ErrorTrackingUploadSourceMaps,
      arrange: (s: WizardStore) => {
        detected(detectSourceMapsProjects, result);
        authed(s);
      },
      screen: SourceMapsScreenId.Detect,
      keys: [{ pick: label }],
      code,
    },
  ]),
  ...(
    [
      ['nothing', 'Exit'],
      ['one', 'Cancel'],
    ] as const
  ).map(([result, label]) => ({
    name: `self-driving integration detect ${result}: ${label}`,
    program: Program.SelfDriving,
    arrange: (s: WizardStore) => {
      detected(detectSelfDrivingIntegrationProjects, result);
      applySetter(s, 'setIntegrate', { integrate: true });
      authed(s);
    },
    screen: SelfDrivingScreenId.IntegrationDetect,
    keys: [{ pick: label }],
    code: 0,
  })),
];

function makeStore(row: Row): WizardStore {
  const store = new WizardStore(row.program);
  store.version = '0.0.0-test';
  store.session = buildSession({ installDir: INSTALL_DIR });
  row.arrange?.(store);
  return store;
}

beforeAll(() => {
  // A screen that still called process.exit would end the test run here.
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${String(code)}) from a screen`);
  });
});

afterEach(cleanup);

it.each(ROWS)('$name asks to end with $code', async (row) => {
  const store = makeStore(row);
  // Before mounting: a screen such as KeepSkills acts as it mounts.
  expect(store.currentScreen).toBe(row.screen);
  const services = createServices(store);
  const { stdin, stdout, lastFrame } = render(
    <ScreenContainer store={store} screens={createScreens(store, services)} />,
  );
  for (const [key, value] of Object.entries({ columns: 120, rows: 40 })) {
    Object.defineProperty(stdout, key, { value, configurable: true });
  }
  stdout.emit('resize');
  await tick(60);
  for (const key of row.keys) {
    if (typeof key === 'string') {
      stdin.write(key);
      await tick();
      continue;
    }
    // Wait for the picker, then walk its focus down to the label.
    const focused = new RegExp(`▸ +${key.pick}\\b`);
    await vi.waitFor(() =>
      expect(toFrameText(lastFrame())).toContain(key.pick),
    );
    for (let i = 0; i < 12 && !focused.test(toFrameText(lastFrame())); i++) {
      stdin.write(DOWN);
      await tick();
    }
    expect(toFrameText(lastFrame())).toMatch(focused);
    stdin.write(ENTER);
    await tick();
  }
  if (row.code === null) await tick(60);
  else await vi.waitFor(() => expect(store.exitRequest).not.toBeNull());
  expect(store.exitRequest).toBe(row.code);
});
