/**
 * Baseline: for each screen a controller can act on, drive the real screen by
 * keyboard on one store and apply the control action on another, then golden
 * both session diffs. Pairs whose diffs differ today are recorded, not hidden.
 */
import { vi, describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpOutcome, RunPhase } from '@shared/run-state';
import { OutroKind } from '@shared/outro';
import { Integration } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import { WizardReadiness } from '@shared/health-checks/readiness';
import {
  buildSession,
  FRAMEWORK_REGISTRY,
  Program,
  type ProgramId,
} from '@programs';
import type { WizardSession } from '@programs/types';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@programs/error-tracking-upload-source-maps';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@programs/self-driving';
import {
  AuditScreenId,
  createTuiStore,
  mountScreens,
  Overlay,
  PostHogIntegrationScreenId,
  readTuiState,
  ScreenId,
  SelfDrivingScreenId,
  SourceMapsScreenId,
  type McpInstaller,
  type WizardStore,
} from '@tui';
import { ACTION_REGISTRY } from '../action-registry';

vi.mock('ink', () => vi.importActual('ink-actual'));
vi.mock('@utils/analytics', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));
vi.mock('@utils/links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/links')>()),
  openTrackedLink: vi.fn(),
}));
vi.mock('@utils/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/clipboard')>()),
  copyToClipboard: vi.fn().mockResolvedValue(false),
  openInBrowser: vi.fn().mockResolvedValue(false),
}));
vi.mock('opn', () => ({ default: vi.fn() }));
vi.mock('@shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api')>()),
  fetchSlackConnected: vi.fn().mockResolvedValue(false),
  fetchUserData: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('@shared/skill-menu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/skill-menu')>()),
  fetchSkillMenu: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock(import('@host/wizard-abort'), async (importOriginal) => ({
  ...(await importOriginal()),
  wizardAbort: vi.fn().mockResolvedValue(undefined),
}));

// A temp dir so KeepSkillsScreen's readdir of `<installDir>/.claude/skills`
// never sees a host directory.
const INSTALL_DIR = mkdtempSync(join(tmpdir(), 'wizard-kb-'));

const ENTER = '\r';
const ESC = '\u001B';
const DOWN = '\u001B[B';
// Real timers on purpose: Ink delivers stdin writes through the event loop,
// and under vi.useFakeTimers the key handlers never run (verified: every
// keyboard diff came back empty). The frames test can fake time since it
// never presses a key.
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const clean = {
  decision: WizardReadiness.Yes,
  health: {} as never,
  reasons: [] as string[],
};
const approved = (ok: boolean) =>
  ({
    organization: { is_ai_data_processing_approved: ok },
  } as unknown as WizardSession['apiUser']);

const confirmed = (s: WizardStore) => {
  s.completeSetup();
  s.setReadinessResult(clean);
};
const authed = (s: WizardStore) => {
  s.setCredentials({
    accessToken: 'phx_test',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 1,
  });
  s.setApiUser(approved(true));
};
const ran = (s: WizardStore) => {
  s.setRunPhase(RunPhase.Running);
  s.setOutroData({ kind: OutroKind.Success, message: 'done' });
  s.setRunPhase(RunPhase.Completed);
};

const fakeInstaller = {
  detectClients: () =>
    Promise.resolve([
      { name: 'Cursor', supportsPlugin: false },
      { name: 'Claude Code', supportsPlugin: true },
    ]),
  install: () => Promise.resolve([]),
} as unknown as McpInstaller;

interface Pair {
  name: string;
  /**
   * Set when the keyboard path and the control action are known to commit
   * different state today. The test asserts the divergence so a fix must
   * clear this field rather than silently re-record.
   */
  knownDivergence?: string;
  program: ProgramId;
  integration?: Integration;
  screen: string;
  /**
   * Extra proof the screen has finished mounting, for screens that settle
   * after their first commit (SetupScreen detects before it shows its
   * picker, SlackConnectScreen checks the connection, McpScreen detects
   * editors). A key hint in the frame means useKeyBindings' effects have
   * run, so its input handler is attached.
   */
  ready?: (s: WizardStore, frame: string) => boolean;
  arrange: (s: WizardStore) => void;
  keys: string[];
  action: string;
  params?: Record<string, unknown>;
}

const nextjsRouterFirst = () => {
  const setup = FRAMEWORK_REGISTRY[Integration.nextjs].metadata.setup;
  if (!setup) throw new Error('nextjs setup questions missing');
  return setup.questions[0].options[0].value;
};

const PAIRS: Pair[] = [
  {
    name: 'intro: enter on Continue vs confirm_setup',
    knownDivergence:
      'keyboard grants scan sharing before completeSetup, confirm_setup only completes setup',
    program: Program.PostHogIntegration,
    screen: PostHogIntegrationScreenId.Intro,
    arrange: () => undefined,
    keys: [ENTER],
    action: 'confirm_setup',
  },
  {
    name: 'setup: enter on first router option vs choose',
    program: Program.PostHogIntegration,
    integration: Integration.nextjs,
    screen: ScreenId.Setup,
    ready: (_, frame) => frame.includes('enter select'),
    arrange: confirmed,
    keys: [ENTER],
    action: 'choose',
    params: { key: 'router', value: nextjsRouterFirst() },
  },
  {
    name: 'outro: any key vs dismiss_outro',
    program: Program.PostHogIntegration,
    screen: ScreenId.Outro,
    arrange: (s) => {
      confirmed(s);
      authed(s);
      ran(s);
    },
    keys: [ENTER],
    action: 'dismiss_outro',
  },
  {
    name: 'mcp: decline install vs set_mcp_outcome skipped',
    knownDivergence:
      'keyboard path lands on keep-skills, whose mount scan sets skillsComplete; the action only records the MCP outcome',
    program: Program.PostHogIntegration,
    screen: ScreenId.Mcp,
    ready: (_, frame) => frame.includes('esc cancel'),
    arrange: (s) => {
      confirmed(s);
      authed(s);
      ran(s);
      s.setOutroDismissed();
    },
    keys: [ESC],
    action: 'set_mcp_outcome',
    params: { outcome: 'skipped' },
  },
  {
    name: 'slack-connect: skip vs dismiss_slack',
    // Only `wizard slack` shows this screen now that no program flow does.
    program: 'slack',
    screen: ScreenId.SlackConnect,
    ready: (_, frame) => frame.includes('esc skip'),
    arrange: (s) => {
      authed(s);
    },
    keys: [DOWN, ENTER],
    action: 'dismiss_slack',
  },
  {
    name: 'keep-skills: mount with no skills dir vs keep_skills',
    knownDivergence:
      'keyboard path runs the skills-dir scan effect, the action only flips the flag',
    program: Program.PostHogIntegration,
    screen: ScreenId.KeepSkills,
    arrange: (s) => {
      confirmed(s);
      authed(s);
      ran(s);
      s.setOutroDismissed();
      s.setMcpComplete(McpOutcome.Skipped);
      s.setSlackStepDismissed();
    },
    keys: [],
    action: 'keep_skills',
    params: { kept: true },
  },
  {
    name: 'audit-outro: any key vs dismiss_outro',
    knownDivergence:
      'keyboard path commits mintHandoff alongside outroDismissed',
    program: Program.Audit,
    screen: AuditScreenId.Outro,
    arrange: (s) => {
      confirmed(s);
      authed(s);
      ran(s);
    },
    keys: [ENTER],
    action: 'dismiss_outro',
  },
  {
    name: 'source-maps-outro: any key vs dismiss_outro',
    knownDivergence:
      'keyboard path commits mintHandoff alongside outroDismissed',
    program: Program.ErrorTrackingUploadSourceMaps,
    screen: SourceMapsScreenId.Outro,
    arrange: (s) => {
      s.completeSetup();
      authed(s);
      s.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedVariant, 'node');
      s.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath, '.');
      ran(s);
    },
    keys: [ENTER],
    action: 'dismiss_outro',
  },
  {
    name: 'self-driving-integration-check: log me in vs set_integrate true',
    program: Program.SelfDriving,
    screen: SelfDrivingScreenId.IntegrationCheck,
    arrange: (s) => {
      s.setFrameworkContext('postHogPresent', false);
      s.completeSetup();
    },
    keys: [ENTER],
    action: 'set_integrate',
    params: { integrate: true },
  },
  {
    name: 'self-driving-handoff: enter vs confirm_self_driving_handoff',
    program: Program.SelfDriving,
    screen: SelfDrivingScreenId.Handoff,
    arrange: (s) => {
      s.setFrameworkContext('postHogPresent', false);
      s.completeSetup();
      s.setIntegrate(true);
      s.setReadinessResult(clean);
      authed(s);
      s.setGithubConnected(false);
      s.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, '.');
      s.setFrameworkConfig(
        Integration.javascriptNode,
        FRAMEWORK_REGISTRY[Integration.javascriptNode],
      );
      s.completeRunStep('integrate-run');
    },
    keys: [ENTER],
    action: 'confirm_self_driving_handoff',
  },
  {
    name: 'wizard-ask: type answer and enter vs answer_question',
    program: Program.PostHogIntegration,
    screen: Overlay.WizardAsk,
    arrange: (s) => {
      void s.requestQuestion({
        id: 'ask-1',
        source: 'test',
        questions: [{ id: 'name', prompt: 'Name?', kind: 'text' }],
      });
    },
    keys: ['yes', ENTER],
    action: 'answer_question',
    params: { answers: { name: 'yes' } },
  },
  {
    name: 'task-notice: enter vs resolve_notice keep',
    program: Program.PostHogIntegration,
    screen: Overlay.TaskNotice,
    arrange: (s) => {
      void s.showTaskNotice({
        title: 'Optional step',
        body: ['Body'],
        prompt: 'Run it?',
        confirmLabel: 'Yes',
        cancelLabel: 'No',
      });
    },
    keys: [ENTER],
    action: 'resolve_notice',
    params: { keep: true },
  },
  {
    name: 'task-notice: escape vs resolve_notice decline',
    program: Program.PostHogIntegration,
    screen: Overlay.TaskNotice,
    arrange: (s) => {
      void s.showTaskNotice({
        title: 'Optional step',
        body: ['Body'],
        prompt: 'Run it?',
        confirmLabel: 'Yes',
        cancelLabel: 'No',
      });
    },
    keys: [ESC],
    action: 'resolve_notice',
    params: { keep: false },
  },
  {
    name: 'port-conflict: enter vs resolve_port_conflict',
    program: Program.PostHogIntegration,
    screen: Overlay.PortConflict,
    arrange: (s) => {
      confirmed(s);
      void s.showPortConflict({
        command: 'node',
        pid: '1',
        port: 8000,
        user: 'me',
      });
    },
    keys: [ENTER],
    action: 'resolve_port_conflict',
  },
  {
    name: 'manual-auth-code: paste code and enter vs submit_auth_code',
    program: Program.PostHogIntegration,
    screen: Overlay.ManualAuthCode,
    arrange: (s) => {
      confirmed(s);
      s.showManualAuthCode();
    },
    keys: ['https://app.test/callback?code=abc123', ENTER],
    action: 'submit_auth_code',
    params: { code: 'abc123' },
  },
  {
    name: 'manual-auth-code: escape vs dismiss_auth_code',
    program: Program.PostHogIntegration,
    screen: Overlay.ManualAuthCode,
    arrange: (s) => {
      confirmed(s);
      s.showManualAuthCode();
    },
    keys: [ESC],
    action: 'dismiss_auth_code',
  },
];

async function makeStore(pair: Pair): Promise<WizardStore> {
  const store = await createTuiStore(pair.program);
  store.version = '0.0.0-test';
  const session = buildSession({ installDir: INSTALL_DIR, ci: false });
  const integration = pair.integration ?? Integration.javascriptNode;
  session.integration = integration;
  session.frameworkConfig = FRAMEWORK_REGISTRY[integration];
  store.session = session;
  store.setDetectionComplete();
  pair.arrange(store);
  return store;
}

interface Snap {
  screen: string;
  overlay: boolean;
  session: Record<string, unknown>;
}

async function snap(store: WizardStore): Promise<Snap> {
  const session: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(store.session)) {
    session[k] = k === 'frameworkConfig' ? (v ? '[config]' : null) : v;
  }
  // The TUI state diffs beside the session, under the same names.
  Object.assign(session, await readTuiState(store));
  return {
    screen: store.currentScreen,
    overlay: store.router.hasOverlay,
    session,
  };
}

function diff(before: Snap, after: Snap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (before.screen !== after.screen) out.screen = after.screen;
  if (before.overlay !== after.overlay) out.overlay = after.overlay;
  for (const key of Object.keys(after.session)) {
    if (
      JSON.stringify(before.session[key]) !== JSON.stringify(after.session[key])
    ) {
      out[key] = after.session[key];
    }
  }
  return out;
}

// These screens commit state from an async effect once they mount: the
// slack connection check and the skills dir scan.
const settled = (s: WizardStore) =>
  (s.currentScreen !== ScreenId.SlackConnect || s.slackConnected !== null) &&
  (s.currentScreen !== ScreenId.KeepSkills || s.skillsComplete);

async function driveKeyboard(pair: Pair): Promise<Record<string, unknown>> {
  const store = await makeStore(pair);
  const screens = await mountScreens(store, { mcpInstaller: fakeInstaller });
  try {
    // Ink attaches the stdin listener from useInput's effect, so keys written
    // before it exists are dropped.
    await vi.waitFor(() => {
      expect(screens.listening()).toBe(true);
      expect(pair.ready?.(store, screens.frame()) ?? true).toBe(true);
      expect(settled(store)).toBe(true);
    });
    expect(store.currentScreen).toBe(pair.screen);
    const before = await snap(store);
    for (const key of pair.keys) {
      screens.write(key);
      await tick();
    }
    await vi.waitFor(() => expect(settled(store)).toBe(true));
    return diff(before, await snap(store));
  } finally {
    screens.unmount();
  }
}

async function applyAction(pair: Pair): Promise<Record<string, unknown>> {
  const store = await makeStore(pair);
  expect(store.currentScreen).toBe(pair.screen);
  const before = await snap(store);
  const action = ACTION_REGISTRY[pair.screen]?.find(
    (a) => a.id === pair.action,
  );
  if (!action) throw new Error(`no action ${pair.action} on ${pair.screen}`);
  action.apply(store, pair.params ?? {});
  return diff(before, await snap(store));
}

describe('keyboard commit vs control action commit', () => {
  for (const pair of PAIRS) {
    it(pair.name, async () => {
      const keyboard = await driveKeyboard(pair);
      const action = await applyAction(pair);
      if (pair.knownDivergence) {
        expect(keyboard, pair.knownDivergence).not.toEqual(action);
      } else {
        expect(keyboard).toEqual(action);
      }
      expect({ keyboard, action }).toMatchSnapshot();
    });
  }
});
