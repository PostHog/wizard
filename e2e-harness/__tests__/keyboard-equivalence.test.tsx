/**
 * Baseline: for each screen a controller can act on, drive the real screen by
 * keyboard on one store and apply the control action on another, then golden
 * both session diffs. Pairs whose diffs differ today are recorded, not hidden.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import {
  FlowStore,
  Program,
  RunPhase,
  McpOutcome,
  type ProgramId,
} from '@store/state/store';
import { ScreenId, Overlay } from '@tui/router';
import { StoreUI } from '@store/ui/store-ui';
import { setUI } from '@store/ui';
import {
  buildSession,
  OutroKind,
  type WizardSession,
} from '@store/session/wizard-session';
import { Integration } from '@store/shared/constants';
import { FRAMEWORK_REGISTRY } from '@store/registry';
import { HostResolution } from '@store/host-resolution';
import { WizardReadiness } from '@store/health-checks/readiness';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@store/programs/error-tracking-upload-source-maps/detect';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@store/programs/self-driving/detect';
import { ScreenContainer } from '@tui/primitives/ScreenContainer';
import {
  createScreens,
  createServices,
  type ScreenServices,
} from '@tui/screen-registry';
import { actionsFor } from '@store/control';
import { flowFor } from '@store/programs/flow-for';
import { UiStore } from '@tui/ui-store';

vi.mock('ink', () => vi.importActual('../../node_modules/ink/build/index.js'));
vi.mock('@store/shared/analytics', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));
vi.mock('@store/shared/links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store/shared/links')>()),
  openTrackedLink: vi.fn(),
}));
vi.mock('@store/shared/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store/shared/clipboard')>()),
  copyToClipboard: vi.fn().mockResolvedValue(false),
  openInBrowser: vi.fn().mockResolvedValue(false),
}));
vi.mock('opn', () => ({ default: vi.fn() }));
vi.mock('@store/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store/api')>()),
  fetchSlackConnected: vi.fn().mockResolvedValue(false),
  fetchUserData: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('@store/tools/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store/tools/tools')>()),
  fetchSkillMenu: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('@store/shared/setup-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store/shared/setup-utils')>()),
  getOrAskForProjectData: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('@store/shared/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@store/shared/wizard-abort')>()),
  wizardAbort: vi.fn().mockResolvedValue(undefined),
}));

const ENTER = '\r';
const ESC = '\u001B';
const DOWN = '\u001B[B';
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

const confirmed = (s: FlowStore) => {
  s.completeSetup();
  s.setReadinessResult(clean);
};
const authed = (s: FlowStore) => {
  s.setCredentials({
    accessToken: 'phx_test',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 1,
  });
  s.setApiUser(approved(true));
};
const ran = (s: FlowStore) => {
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
} as unknown as ScreenServices['mcpInstaller'];

interface Pair {
  name: string;
  program: ProgramId;
  integration?: Integration;
  screen: string;
  arrange: (s: FlowStore) => void;
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
    program: Program.PostHogIntegration,
    screen: ScreenId.Intro,
    arrange: () => undefined,
    keys: [ENTER],
    action: 'confirm_setup',
  },
  {
    name: 'setup: enter on first router option vs choose',
    program: Program.PostHogIntegration,
    integration: Integration.nextjs,
    screen: ScreenId.Setup,
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
    program: Program.PostHogIntegration,
    screen: ScreenId.Mcp,
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
    program: Program.PostHogIntegration,
    screen: ScreenId.SlackConnect,
    arrange: (s) => {
      confirmed(s);
      authed(s);
      ran(s);
      s.setOutroDismissed();
      s.setMcpComplete(McpOutcome.Skipped);
    },
    keys: [DOWN, ENTER],
    action: 'dismiss_slack',
  },
  {
    name: 'keep-skills: mount with no skills dir vs keep_skills',
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
    program: Program.Audit,
    screen: ScreenId.AuditOutro,
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
    program: Program.ErrorTrackingUploadSourceMaps,
    screen: ScreenId.SourceMapsOutro,
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
    screen: ScreenId.SelfDrivingIntegrationCheck,
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
    screen: ScreenId.SelfDrivingHandoff,
    arrange: (s) => {
      s.setFrameworkContext('postHogPresent', false);
      s.completeSetup();
      s.setIntegrate(true);
      s.setReadinessResult(clean);
      authed(s);
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

function makeStore(pair: Pair): FlowStore {
  const store = new FlowStore(flowFor(pair.program).flow);
  store.version = '0.0.0-test';
  setUI(new StoreUI(store));
  const session = buildSession({ installDir: '/app', ci: false });
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

function snap(store: FlowStore): Snap {
  const session: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(store.session)) {
    session[k] = k === 'frameworkConfig' ? (v ? '[config]' : null) : v;
  }
  return {
    screen: store.currentScreen,
    overlay: store.hasInterrupt,
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

async function driveKeyboard(pair: Pair): Promise<Record<string, unknown>> {
  const store = makeStore(pair);
  const services = { ...createServices(store), mcpInstaller: fakeInstaller };
  const screens = createScreens(store, services);
  const { stdin, unmount } = render(
    <ScreenContainer store={store} ui={new UiStore(store)} screens={screens} />,
  );
  await tick(60);
  expect(store.currentScreen).toBe(pair.screen);
  const before = snap(store);
  for (const key of pair.keys) {
    stdin.write(key);
    await tick();
  }
  await tick(60);
  const after = snap(store);
  unmount();
  return diff(before, after);
}

function applyAction(pair: Pair): Record<string, unknown> {
  const store = makeStore(pair);
  expect(store.currentScreen).toBe(pair.screen);
  const before = snap(store);
  const action = actionsFor(flowFor(pair.program).flow, pair.screen).find(
    (a) => a.id === pair.action,
  );
  if (!action) throw new Error(`no action ${pair.action} on ${pair.screen}`);
  action.apply(store, pair.params ?? {});
  return diff(before, snap(store));
}

/**
 * Keys the rendered walk commits from the *next* screen's mount effect (keep-skills
 * completes with no skills dir; slack-connect records "not connected"), which no
 * control action produces. Everything else must match exactly.
 */
const MOUNT_EFFECTS: Record<string, readonly string[]> = {
  'mcp: decline install vs set_mcp_outcome skipped': ['slackConnected'],
  'slack-connect: skip vs dismiss_slack': ['skillsComplete'],
  'audit-outro: any key vs dismiss_outro': ['skillsComplete'],
  'source-maps-outro: any key vs dismiss_outro': ['skillsComplete'],
};

describe('keyboard commit vs control action commit', () => {
  beforeAll(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });
  afterEach(() => cleanup());

  for (const pair of PAIRS) {
    it(pair.name, async () => {
      const keyboard = await driveKeyboard(pair);
      const action = applyAction(pair);
      const mountOnly = MOUNT_EFFECTS[pair.name] ?? [];
      const keyboardOwn = Object.fromEntries(
        Object.entries(keyboard).filter(([k]) => !mountOnly.includes(k)),
      );
      if (pair.keys.length === 0) {
        // A bare mount commits nothing in this harness; the action still must.
        expect(keyboard).toEqual({});
        expect(Object.keys(action).length).toBeGreaterThan(0);
      } else {
        expect(action).toEqual(keyboardOwn);
        for (const key of mountOnly) expect(keyboard).toHaveProperty(key);
      }
      expect({ keyboard, action }).toMatchSnapshot();
    });
  }
});
