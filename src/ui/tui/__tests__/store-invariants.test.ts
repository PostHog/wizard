/**
 * Behaviour baseline for WizardStore + WizardRouter, taken before a refactor.
 * Every expectation here pins what the code does today, exceptions included.
 */

import {
  WizardStore,
  TaskStatus,
  Program,
  type ProgramId,
  ScreenId,
  Overlay,
  RunPhase,
  McpOutcome,
  type ScreenName,
} from '@ui/tui/store';
import {
  buildSession,
  DiscoveredFeature,
  OutroKind,
  type AskAnswers,
  type PendingQuestion,
  type TaskNotice,
  type WizardSession,
} from '@lib/wizard-session';
import { EXPANDED_COUNT } from '@ui/tui/constants';
import { PROGRAM_SEQUENCES } from '@ui/tui/screen-sequences';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { HostResolution } from '@shared/host-resolution';
import { Integration } from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { analytics } from '@utils/analytics';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import type { SettingsConflict } from '@shared/claude-settings';

vi.mock('@utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));

vi.mock('@shared/health-checks/readiness.js', () => ({
  evaluateWizardReadiness: vi.fn().mockResolvedValue({
    decision: 'yes',
    health: {},
    reasons: [],
  }),
  WizardReadiness: {
    Yes: 'yes',
    No: 'no',
    YesWithWarnings: 'yes-with-warnings',
  },
  SERVICE_LABELS: {},
  // Generated signup sessions reach the branch that reads this config.
  SIGNUP_WIZARD_READINESS_CONFIG: {},
  getBlockingServiceKeys: vi.fn(() => []),
}));

const wizardCaptureMock = analytics.wizardCapture as Mock;
const setTagMock = analytics.setTag as Mock;

const CREDENTIALS = {
  accessToken: 'tok',
  projectApiKey: 'pk',
  host: HostResolution.fromApiHost('https://app.posthog.com'),
  projectId: 1,
};

const CLEAN_READINESS = {
  decision: WizardReadiness.Yes,
  health: {} as never,
  reasons: [],
};

const SETTINGS_CONFLICT: SettingsConflict = {
  source: 'project',
  path: '/app/.claude/settings.json',
  keys: ['ANTHROPIC_BASE_URL'],
  writable: true,
};

const TASK_NOTICE: TaskNotice = {
  title: 'Connect your sources',
  body: ['body'],
  confirmLabel: 'Continue',
  cancelLabel: 'Skip',
  prompt: 'Connect these?',
};

const PENDING_QUESTION: PendingQuestion = {
  id: 'ask-1',
  questions: [{ id: 'a', prompt: 'p', kind: 'text' }],
  source: 'test-skill',
};

const ANSWERS: AskAnswers = { a: 'yes' };

const aiUser = (approved: boolean): WizardSession['apiUser'] =>
  ({ organization: { is_ai_data_processing_approved: approved } } as never);

function createStore(program?: ProgramId): WizardStore {
  return new WizardStore(program);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function tracked(promise: Promise<unknown>): { resolved: boolean } {
  const state = { resolved: false };
  void promise.then(() => {
    state.resolved = true;
  });
  return state;
}

function countEmissions(store: WizardStore, act: () => void): number {
  let count = 0;
  const unsubscribe = store.subscribe(() => {
    count += 1;
  });
  act();
  unsubscribe();
  return count;
}

interface MutationCase {
  name: string;
  /** Untracked setup — emissions it fires are excluded from the count. */
  prepare?: (store: WizardStore) => void;
  invoke: (store: WizardStore) => void;
  emits: number;
}

const MUTATIONS: MutationCase[] = [
  {
    name: 'setCurrentStage',
    invoke: (s) => s.setCurrentStage('stage'),
    emits: 1,
  },
  {
    name: 'toggleStatusExpanded',
    invoke: (s) => s.toggleStatusExpanded(),
    emits: 1,
  },
  {
    name: 'setStatusExpanded',
    invoke: (s) => s.setStatusExpanded(true),
    emits: 1,
  },
  { name: 'completeSetup', invoke: (s) => s.completeSetup(), emits: 1 },
  { name: 'grantSharing', invoke: (s) => s.grantSharing(), emits: 1 },
  { name: 'declineSharing', invoke: (s) => s.declineSharing(), emits: 1 },
  {
    name: 'setRunPhase',
    invoke: (s) => s.setRunPhase(RunPhase.Running),
    emits: 1,
  },
  {
    name: 'setCredentials',
    invoke: (s) => s.setCredentials(CREDENTIALS),
    emits: 1,
  },
  {
    name: 'setAccessToken',
    invoke: (s) => s.setAccessToken(CREDENTIALS),
    emits: 1,
  },
  {
    name: 'setRoleAtOrganization',
    invoke: (s) => s.setRoleAtOrganization('engineer'),
    emits: 1,
  },
  { name: 'setApiUser', invoke: (s) => s.setApiUser(aiUser(true)), emits: 1 },
  {
    name: 'setFrameworkConfig',
    invoke: (s) =>
      s.setFrameworkConfig(
        Integration.javascriptNode,
        FRAMEWORK_REGISTRY[Integration.javascriptNode],
      ),
    emits: 1,
  },
  {
    name: 'setDetectionComplete',
    invoke: (s) => s.setDetectionComplete(),
    emits: 1,
  },
  {
    name: 'setDetectedFramework',
    invoke: (s) => s.setDetectedFramework('Node.js'),
    emits: 1,
  },
  {
    name: 'setPosthogSdkDetected',
    invoke: (s) => s.setPosthogSdkDetected(true),
    emits: 1,
  },
  {
    name: 'setSpellbook',
    invoke: (s) => s.setSpellbook({ path: '/app/skill', skillsIncluded: true }),
    emits: 1,
  },
  {
    name: 'setMintHandoff',
    invoke: (s) => s.setMintHandoff('continue'),
    emits: 1,
  },
  {
    name: 'setSkillId',
    invoke: (s) => s.setSkillId('integration-nextjs'),
    emits: 1,
  },
  {
    name: 'setUnsupportedVersion',
    invoke: (s) =>
      s.setUnsupportedVersion({ current: '1', minimum: '2', docsUrl: 'u' }),
    emits: 1,
  },
  {
    name: 'setLoginUrl',
    invoke: (s) => s.setLoginUrl('http://localhost:8010'),
    emits: 1,
  },
  {
    name: 'setAuthorizeUrl',
    invoke: (s) => s.setAuthorizeUrl('https://app.posthog.com'),
    emits: 1,
  },
  {
    name: 'setReadinessResult',
    invoke: (s) => s.setReadinessResult(CLEAN_READINESS),
    emits: 1,
  },
  { name: 'dismissOutage', invoke: (s) => s.dismissOutage(), emits: 1 },
  {
    name: 'showSettingsOverride',
    invoke: (s) => void s.showSettingsOverride([SETTINGS_CONFLICT], () => true),
    emits: 1,
  },
  {
    name: 'showPortConflict',
    invoke: (s) =>
      void s.showPortConflict({
        command: 'node',
        pid: '1',
        port: 8010,
        user: 'u',
      }),
    emits: 1,
  },
  {
    name: 'resolvePortConflict',
    prepare: (s) =>
      void s.showPortConflict({
        command: 'node',
        pid: '1',
        port: 8010,
        user: 'u',
      }),
    invoke: (s) => s.resolvePortConflict(),
    emits: 1,
  },
  {
    name: 'showTaskNotice',
    invoke: (s) => void s.showTaskNotice(TASK_NOTICE),
    emits: 1,
  },
  {
    name: 'resolveTaskNotice',
    prepare: (s) => void s.showTaskNotice(TASK_NOTICE),
    invoke: (s) => s.resolveTaskNotice(true),
    emits: 1,
  },
  // No overlay push — the modal is opened separately by showManualAuthCode.
  {
    name: 'waitForManualAuthCode',
    invoke: (s) => void s.waitForManualAuthCode(),
    emits: 0,
  },
  {
    name: 'showManualAuthCode',
    invoke: (s) => s.showManualAuthCode(),
    emits: 1,
  },
  {
    name: 'dismissManualAuthCode',
    prepare: (s) => s.showManualAuthCode(),
    invoke: (s) => s.dismissManualAuthCode(),
    emits: 1,
  },
  {
    name: 'submitManualAuthCode',
    prepare: (s) => s.showManualAuthCode(),
    invoke: (s) => s.submitManualAuthCode('code'),
    emits: 1,
  },
  {
    name: 'requestQuestion',
    invoke: (s) => void s.requestQuestion(PENDING_QUESTION),
    emits: 1,
  },
  {
    name: 'resolvePendingQuestion',
    prepare: (s) => void s.requestQuestion(PENDING_QUESTION),
    invoke: (s) => s.resolvePendingQuestion(ANSWERS),
    emits: 1,
  },
  {
    name: 'cancelPendingQuestion',
    prepare: (s) => void s.requestQuestion(PENDING_QUESTION),
    invoke: (s) => s.cancelPendingQuestion(),
    emits: 1,
  },
  {
    name: 'backupAndFixSettingsOverride',
    prepare: (s) =>
      void s.showSettingsOverride([SETTINGS_CONFLICT], () => true),
    invoke: (s) => void s.backupAndFixSettingsOverride(),
    emits: 1,
  },
  {
    name: 'showAuthError',
    invoke: (s) =>
      s.showAuthError({ hasSettingsConflict: false, logFilePath: '/tmp/log' }),
    emits: 1,
  },
  {
    name: 'showSessionTimeout',
    invoke: (s) => s.showSessionTimeout(),
    emits: 1,
  },
  {
    name: 'addDiscoveredFeature',
    invoke: (s) => s.addDiscoveredFeature(DiscoveredFeature.Stripe),
    emits: 1,
  },
  {
    name: 'setMcpComplete',
    invoke: (s) => s.setMcpComplete(McpOutcome.Installed, ['claude'], 'all'),
    emits: 1,
  },
  {
    name: 'setSkillsComplete',
    invoke: (s) => s.setSkillsComplete(true),
    emits: 1,
  },
  {
    name: 'setMcpSuggestedPromptsDismissed',
    invoke: (s) => s.setMcpSuggestedPromptsDismissed(),
    emits: 1,
  },
  {
    name: 'setSlackStepDismissed',
    invoke: (s) => s.setSlackStepDismissed(),
    emits: 1,
  },
  {
    name: 'setSlackConnected',
    invoke: (s) => s.setSlackConnected(true),
    emits: 1,
  },
  {
    name: 'setGithubConnected',
    invoke: (s) => s.setGithubConnected(true),
    emits: 1,
  },
  {
    name: 'declineGithub',
    invoke: (s) =>
      s.declineGithub({ kind: OutroKind.Cancel, message: 'declined' }),
    emits: 1,
  },
  {
    name: 'setIntegrate',
    invoke: (s) => s.setIntegrate(true, { via: 'screen' }),
    emits: 1,
  },
  {
    name: 'chooseProvisionAccount',
    invoke: (s) => s.chooseProvisionAccount('a@b.com', 'us'),
    emits: 1,
  },
  {
    name: 'confirmSelfDrivingHandoff',
    invoke: (s) => s.confirmSelfDrivingHandoff(),
    emits: 1,
  },
  {
    name: 'completeRunStep',
    invoke: (s) => s.completeRunStep('integrate-run'),
    emits: 1,
  },
  { name: 'setOutroDismissed', invoke: (s) => s.setOutroDismissed(), emits: 1 },
  {
    name: 'setOutroData',
    invoke: (s) => s.setOutroData({ kind: OutroKind.Success, message: 'done' }),
    emits: 1,
  },
  {
    name: 'setDashboardUrl',
    invoke: (s) => s.setDashboardUrl('https://d'),
    emits: 1,
  },
  {
    name: 'setNotebookUrl',
    invoke: (s) => s.setNotebookUrl('https://n'),
    emits: 1,
  },
  {
    name: 'setFrameworkContext',
    invoke: (s) => s.setFrameworkContext('k', 'v'),
    emits: 1,
  },
  {
    name: 'switchProgram',
    invoke: (s) => s.switchProgram(Program.Metrics),
    emits: 1,
  },
  {
    name: 'pushOverlay',
    invoke: (s) => s.pushOverlay(Overlay.WizardAsk),
    emits: 1,
  },
  {
    name: 'popOverlay',
    prepare: (s) => s.pushOverlay(Overlay.WizardAsk),
    invoke: (s) => s.popOverlay(),
    emits: 1,
  },
  { name: 'pushStatus', invoke: (s) => s.pushStatus('working'), emits: 1 },
  { name: 'toggleTokenHud', invoke: (s) => s.toggleTokenHud(), emits: 1 },
  {
    name: 'addTokenUsage',
    invoke: (s) =>
      s.addTokenUsage({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5m: 0,
        cacheCreation1h: 0,
      }),
    emits: 1,
  },
  {
    name: 'setFinalTokenCostUsd',
    invoke: (s) => s.setFinalTokenCostUsd(1.25),
    emits: 1,
  },
  {
    name: 'setTasks',
    invoke: (s) =>
      s.setTasks([{ label: 'a', status: TaskStatus.Pending, done: false }]),
    emits: 1,
  },
  {
    name: 'updateTask',
    prepare: (s) =>
      s.setTasks([{ label: 'a', status: TaskStatus.Pending, done: false }]),
    invoke: (s) => s.updateTask(0, true),
    emits: 1,
  },
  {
    name: 'setEventPlan',
    invoke: (s) => s.setEventPlan([{ name: 'signed_up', description: 'd' }]),
    emits: 1,
  },
  {
    name: 'setHandoffText',
    invoke: (s) => s.setHandoffText('handoff'),
    emits: 1,
  },
  // Render-only cursor: the learn card drives its own re-render.
  {
    name: 'setLearnCardBlockIdx',
    invoke: (s) => s.setLearnCardBlockIdx(2),
    emits: 0,
  },
  {
    name: 'setLearnCardComplete',
    invoke: (s) => s.setLearnCardComplete(),
    emits: 1,
  },
  {
    name: 'syncTodos',
    invoke: (s) => s.syncTodos([{ content: 'a', status: 'pending' }]),
    emits: 1,
  },
];

/** Read-only or notification-plumbing methods, excluded by the task brief. */
const NON_MUTATING = [
  'subscribe',
  'getSnapshot',
  'getVersion',
  'runInitHooks',
  'runReadyHooks',
  'getGate',
  'waitUntil',
  'onEnterScreen',
  'emitChange',
];

describe('store invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('one notification per mutation', () => {
    it('enumerates every public method on the class', () => {
      const methods = Object.getOwnPropertyNames(WizardStore.prototype).filter(
        (name) => {
          const descriptor = Object.getOwnPropertyDescriptor(
            WizardStore.prototype,
            name,
          );
          return (
            typeof descriptor?.value === 'function' &&
            name !== 'constructor' &&
            !name.startsWith('_')
          );
        },
      );
      const covered = new Set([
        ...MUTATIONS.map((c) => c.name),
        ...NON_MUTATING,
      ]);

      expect(methods.filter((name) => !covered.has(name))).toEqual([]);
      expect([...covered].filter((name) => !methods.includes(name))).toEqual(
        [],
      );
    });

    it.each(MUTATIONS)(
      '$name notifies $emits time(s)',
      ({ prepare, invoke, emits }) => {
        const store = createStore();
        prepare?.(store);
        expect(countEmissions(store, () => invoke(store))).toBe(emits);
      },
    );

    it('cancelPendingQuestion with no question pending notifies nothing', () => {
      const store = createStore();
      expect(countEmissions(store, () => store.cancelPendingQuestion())).toBe(
        0,
      );
    });

    it('backupAndFixSettingsOverride with no pending fix notifies nothing', () => {
      const store = createStore();
      expect(
        countEmissions(store, () => void store.backupAndFixSettingsOverride()),
      ).toBe(0);
    });

    it('updateTask on a missing index notifies nothing', () => {
      const store = createStore();
      expect(countEmissions(store, () => store.updateTask(3, true))).toBe(0);
    });

    it('switchProgram to the active program notifies nothing', () => {
      const store = createStore();
      expect(
        countEmissions(store, () =>
          store.switchProgram(Program.PostHogIntegration),
        ),
      ).toBe(0);
    });

    it('setStatusExpanded to the current value notifies nothing', () => {
      const store = createStore();
      expect(countEmissions(store, () => store.setStatusExpanded(false))).toBe(
        0,
      );
    });

    it('setCurrentStage with the same stage notifies nothing', () => {
      const store = createStore();
      store.setCurrentStage('stage');
      expect(countEmissions(store, () => store.setCurrentStage('stage'))).toBe(
        0,
      );
    });

    it('setHandoffText with identical text notifies nothing', () => {
      const store = createStore();
      store.setHandoffText('handoff');
      expect(countEmissions(store, () => store.setHandoffText('handoff'))).toBe(
        0,
      );
    });
  });

  describe('gates latch once', () => {
    it('resolves when the predicate turns true and stays resolved after it turns false', async () => {
      const store = createStore();
      const gate = tracked(store.getGate('intro'));
      await flushMicrotasks();
      expect(gate.resolved).toBe(false);

      store.completeSetup();
      await flushMicrotasks();
      expect(gate.resolved).toBe(true);

      store.session = buildSession({});
      await flushMicrotasks();
      expect(store.session.setupConfirmed).toBe(false);

      const relatched = tracked(store.getGate('intro'));
      await flushMicrotasks();
      expect(relatched.resolved).toBe(true);
    });

    it('returns an already resolved promise for an unknown step', async () => {
      const store = createStore();
      const gate = tracked(store.getGate('nonexistent'));
      await flushMicrotasks();
      expect(gate.resolved).toBe(true);
    });

    it('waitUntil resolves on the next commit that matches', async () => {
      const store = createStore();
      const waiter = tracked(store.waitUntil((s) => s.credentials !== null));
      await flushMicrotasks();
      expect(waiter.resolved).toBe(false);

      store.setDetectionComplete();
      await flushMicrotasks();
      expect(waiter.resolved).toBe(false);

      store.setCredentials(CREDENTIALS);
      await flushMicrotasks();
      expect(waiter.resolved).toBe(true);
    });

    it('waitUntil evaluates live, so an already true predicate resolves immediately', async () => {
      const store = createStore();
      store.completeSetup();
      const waiter = tracked(store.waitUntil((s) => s.setupConfirmed));
      await flushMicrotasks();
      expect(waiter.resolved).toBe(true);
    });
  });

  describe('overlays are LIFO', () => {
    it('unwinds in reverse order back to the program screen', () => {
      const store = createStore();
      expect(store.router.hasOverlay).toBe(false);

      store.pushOverlay(Overlay.AuthError);
      store.pushOverlay(Overlay.SessionTimeout);
      expect(store.router.resolve(store.session)).toBe(Overlay.SessionTimeout);
      expect(store.router.hasOverlay).toBe(true);

      store.popOverlay();
      expect(store.router.resolve(store.session)).toBe(Overlay.AuthError);
      expect(store.router.hasOverlay).toBe(true);

      store.popOverlay();
      expect(store.router.hasOverlay).toBe(false);
      expect(store.router.resolve(store.session)).toBe(ScreenId.Intro);
    });

    it('tracks the nav direction across emits and overlay moves', () => {
      const store = createStore();
      expect(store.lastNavDirection).toBeNull();

      store.emitChange();
      expect(store.lastNavDirection).toBe('push');

      store.pushOverlay(Overlay.AuthError);
      expect(store.lastNavDirection).toBe('push');

      store.popOverlay();
      expect(store.lastNavDirection).toBe('pop');

      store.emitChange();
      expect(store.lastNavDirection).toBe('push');
    });
  });

  describe('status ring', () => {
    it('skips consecutive duplicates but keeps a repeat that is not adjacent', () => {
      const store = createStore();
      store.pushStatus('a');
      store.pushStatus('a');
      store.pushStatus('b');
      store.pushStatus('a');
      expect(store.statusMessages).toEqual(['a', 'b', 'a']);
    });

    it('caps at the expanded window, dropping the oldest', () => {
      const store = createStore();
      const total = EXPANDED_COUNT + 3;
      for (let i = 0; i < total; i++) store.pushStatus(`m${i}`);

      expect(store.statusMessages).toHaveLength(EXPANDED_COUNT);
      expect(store.statusMessages[0]).toBe(`m${total - EXPANDED_COUNT}`);
      expect(store.statusMessages[EXPANDED_COUNT - 1]).toBe(`m${total - 1}`);
    });
  });

  describe('screen resolution is total', () => {
    const PROGRAM_IDS = PROGRAM_REGISTRY.map((config) => config.id);
    const SCREEN_NAMES = new Set<string>([
      ...Object.values(ScreenId),
      ...Object.values(Overlay),
    ]);
    const SEED = 0x5eed;
    const SESSION_COUNT = 200;

    function mulberry32(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function randomSession(rand: () => number): WizardSession {
      const pick = <T>(values: readonly T[]): T =>
        values[Math.floor(rand() * values.length)];
      const flip = (): boolean => rand() < 0.5;

      const session = buildSession({ installDir: '/app', ci: flip() });
      session.setupConfirmed = flip();
      session.credentials = flip() ? CREDENTIALS : null;
      session.apiUser = pick([null, aiUser(true), aiUser(false)]);
      session.runPhase = pick(Object.values(RunPhase));
      session.outroDismissed = flip();
      session.outroData = flip()
        ? { kind: OutroKind.Error, message: 'x' }
        : null;
      session.mintHandoff = pick([null, 'exit', 'continue'] as const);
      session.mcpComplete = flip();
      session.mcpOutcome = pick([null, ...Object.values(McpOutcome)]);
      session.slackStepDismissed = flip();
      session.skillsComplete = flip();
      session.integrate = pick([null, true, false]);
      if (flip()) {
        session.integration = Integration.javascriptNode;
        session.frameworkConfig =
          FRAMEWORK_REGISTRY[Integration.javascriptNode];
      }
      session.selfDrivingHandoffConfirmed = flip();
      session.githubConnected = pick([null, true, false]);
      session.githubDeclined = flip();
      session.readinessResult = flip() ? CLEAN_READINESS : null;
      session.outageDismissed = flip();
      if (flip()) session.frameworkContext = { postHogPresent: flip() };
      session.completedRuns = flip() ? ['integrate-run'] : [];
      session.detectionComplete = flip();
      session.signup = flip();
      return session;
    }

    function resolveAll(program: ProgramId): ScreenName[] {
      const store = createStore(program);
      const rand = mulberry32(SEED);
      const screens: ScreenName[] = [];
      for (let i = 0; i < SESSION_COUNT; i++) {
        screens.push(store.router.resolve(randomSession(rand)));
      }
      return screens;
    }

    it.each(PROGRAM_IDS)(
      'resolves a known screen for every session in %s',
      (program) => {
        const screens = resolveAll(program);
        expect(screens).toHaveLength(SESSION_COUNT);
        expect(screens.filter((screen) => !SCREEN_NAMES.has(screen))).toEqual(
          [],
        );
      },
    );

    it.each(PROGRAM_IDS)('%s sequence ends on the exit screen', (program) => {
      const sequence = PROGRAM_SEQUENCES[program];
      expect(sequence[sequence.length - 1].id).toBe(ScreenId.Exit);
    });

    it('generates the same sessions from the same seed', () => {
      expect(resolveAll(Program.PostHogIntegration)).toEqual(
        resolveAll(Program.PostHogIntegration),
      );
    });
  });

  describe('transition analytics shape', () => {
    function driveIntegrationFlow(): void {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult(CLEAN_READINESS);
      store.setCredentials(CREDENTIALS);
      store.setRunPhase(RunPhase.Running);
      store.setRunPhase(RunPhase.Completed);
      store.setOutroDismissed();
    }

    it('captures one screen event per transition', () => {
      driveIntegrationFlow();

      const screenEvents = wizardCaptureMock.mock.calls
        .filter(([event]) => String(event).startsWith('screen '))
        .map(([event, props]) => ({
          event,
          from_screen: props.from_screen,
          program_id: props.program_id,
        }));

      expect(screenEvents).toMatchInlineSnapshot(`
        [
          {
            "event": "screen auth",
            "from_screen": "health-check",
            "program_id": "posthog-integration",
          },
          {
            "event": "screen run",
            "from_screen": "auth",
            "program_id": "posthog-integration",
          },
          {
            "event": "screen outro",
            "from_screen": "run",
            "program_id": "posthog-integration",
          },
          {
            "event": "screen mcp",
            "from_screen": "outro",
            "program_id": "posthog-integration",
          },
        ]
      `);
    });

    it('tags $screen_name on every transition', () => {
      driveIntegrationFlow();

      const screenTags = setTagMock.mock.calls
        .filter(([key]) => key === '$screen_name')
        .map(([, value]) => value);

      expect(screenTags).toMatchInlineSnapshot(`
        [
          "health-check",
          "auth",
          "run",
          "outro",
          "mcp",
        ]
      `);
    });
  });
});
