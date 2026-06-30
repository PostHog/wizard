import {
  WizardStore,
  TaskStatus,
  Program,
  type ProgramId,
  ScreenId,
  Overlay,
  RunPhase,
  McpOutcome,
} from '@ui/tui/store';
import { OutroKind, AdditionalFeature } from '@lib/wizard-session';
import { EXPANDED_COUNT } from '@ui/tui/constants';
import {
  WizardReadiness,
  evaluateWizardReadiness,
} from '@lib/health-checks/readiness';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@lib/host-resolution';
import { Integration } from '@lib/constants';
import { analytics } from '@utils/analytics';

vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));

vi.mock('../../../lib/health-checks/readiness.js', () => ({
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
  getBlockingServiceKeys: vi.fn(() => []),
}));

function createStore(program?: ProgramId): WizardStore {
  return new WizardStore(program);
}

const wizardCaptureMock = analytics.wizardCapture as Mock;
const evaluateWizardReadinessMock = evaluateWizardReadiness as MockedFunction<
  typeof evaluateWizardReadiness
>;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('WizardStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateWizardReadinessMock.mockResolvedValue({
      decision: WizardReadiness.Yes,
      health: {} as never,
      reasons: [],
    });
  });
  // ── Construction ─────────────────────────────────────────────────

  describe('constructor', () => {
    it('initialises with default state', () => {
      const store = createStore();
      expect(store.version).toBe('');
      expect(store.statusMessages).toEqual([]);
      expect(store.tasks).toEqual([]);
      expect(store.session).toEqual(buildSession({}));
    });

    it('defaults to Wizard flow', () => {
      const store = createStore();
      expect(store.router.activeProgram).toBe(Program.PostHogIntegration);
    });

    it('accepts a custom flow', () => {
      const store = createStore(Program.McpAdd);
      expect(store.router.activeProgram).toBe(Program.McpAdd);
    });

    it('starts with version 0', () => {
      const store = createStore();
      expect(store.getVersion()).toBe(0);
      expect(store.getSnapshot()).toBe(0);
    });
  });

  // ── Change notification ──────────────────────────────────────────

  describe('change notification', () => {
    it('emitChange increments version and notifies subscribers', () => {
      const store = createStore();
      const listener = vi.fn();
      store.subscribe(listener);

      store.emitChange();

      expect(store.getVersion()).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('version increments on each emitChange', () => {
      const store = createStore();
      store.emitChange();
      store.emitChange();
      store.emitChange();
      expect(store.getVersion()).toBe(3);
    });
  });

  // ── React integration (subscribe / getSnapshot) ──────────────────

  describe('subscribe / getSnapshot', () => {
    it('subscribe registers a listener that fires on change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.emitChange();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('subscribe returns an unsubscribe function', () => {
      const store = createStore();
      const cb = vi.fn();
      const unsub = store.subscribe(cb);

      unsub();
      store.emitChange();
      expect(cb).not.toHaveBeenCalled();
    });

    it('getSnapshot returns the current version', () => {
      const store = createStore();
      expect(store.getSnapshot()).toBe(0);
      store.emitChange();
      expect(store.getSnapshot()).toBe(1);
    });

    it('is compatible with useSyncExternalStore contract', () => {
      const store = createStore();
      const cb = vi.fn();
      const unsub = store.subscribe(cb);

      const v1 = store.getSnapshot();
      store.completeSetup();
      const v2 = store.getSnapshot();

      expect(v2).toBeGreaterThan(v1);
      expect(cb).toHaveBeenCalled();
      unsub();
    });
  });

  // ── Session setters ──────────────────────────────────────────────

  describe('session setters', () => {
    it('completeSetup sets setupConfirmed and resolves intro gate', async () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.completeSetup();

      expect(store.session.setupConfirmed).toBe(true);
      await store.getGate('intro');
      expect(cb).toHaveBeenCalled();
    });

    it('setRunPhase updates session.runPhase', () => {
      const store = createStore();
      store.setRunPhase(RunPhase.Running);
      expect(store.session.runPhase).toBe(RunPhase.Running);
    });

    it('setCredentials updates session.credentials', () => {
      const store = createStore();
      const creds = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 42,
      };
      store.setCredentials(creds);
      expect(store.session.credentials).toEqual(creds);
    });

    it('setFrameworkConfig updates integration and frameworkConfig', () => {
      const store = createStore();
      const integration = Integration.nextjs;
      const config = {
        metadata: { name: 'Next.js' },
      } as WizardStore['session']['frameworkConfig'];

      store.setFrameworkConfig(integration, config);

      expect(store.session.integration).toBe(integration);
      expect(store.session.frameworkConfig).toBe(config);
    });

    it('setDetectionComplete marks detection done', () => {
      const store = createStore();
      expect(store.session.detectionComplete).toBe(false);
      store.setDetectionComplete();
      expect(store.session.detectionComplete).toBe(true);
    });

    it('setDetectedFramework sets the label', () => {
      const store = createStore();
      store.setDetectedFramework('Django');
      expect(store.session.detectedFrameworkLabel).toBe('Django');
    });

    it('setLoginUrl sets and clears the login URL', () => {
      const store = createStore();
      store.setLoginUrl('https://example.com/auth');
      expect(store.session.loginUrl).toBe('https://example.com/auth');

      store.setLoginUrl(null);
      expect(store.session.loginUrl).toBeNull();
    });

    it('setReadinessResult sets readiness info', () => {
      const store = createStore();
      const result = {
        decision: WizardReadiness.No,
        health: {} as never,
        reasons: ['Anthropic: down'],
      };
      store.setReadinessResult(result);
      expect(store.session.readinessResult).toEqual(result);

      store.setReadinessResult(null);
      expect(store.session.readinessResult).toBeNull();
    });

    it('setMcpComplete marks MCP step done with outcome', () => {
      const store = createStore();
      expect(store.session.mcpComplete).toBe(false);
      store.setMcpComplete(McpOutcome.Installed, ['Cursor']);
      expect(store.session.mcpComplete).toBe(true);
      expect(store.session.mcpOutcome).toBe(McpOutcome.Installed);
      expect(store.session.mcpInstalledClients).toEqual(['Cursor']);
    });

    it('setMcpSuggestedPromptsDismissed flips the session flag', () => {
      const store = createStore();
      expect(store.session.mcpSuggestedPromptsDismissed).toBe(false);
      store.setMcpSuggestedPromptsDismissed();
      expect(store.session.mcpSuggestedPromptsDismissed).toBe(true);
    });

    it('setOutroData sets outro information', () => {
      const store = createStore();
      const data = { kind: OutroKind.Success, message: 'Done!' };
      store.setOutroData(data);
      expect(store.session.outroData).toEqual(data);
    });

    it('setFrameworkContext sets key-value pairs', () => {
      const store = createStore();
      store.setFrameworkContext('packageManager', 'pnpm');
      expect(store.session.frameworkContext['packageManager']).toBe('pnpm');

      store.setFrameworkContext('srcDir', 'src');
      expect(store.session.frameworkContext['srcDir']).toBe('src');
    });

    it('every setter emits exactly one change event', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.completeSetup();
      store.setRunPhase(RunPhase.Running);
      store.setCredentials(null);
      store.setDetectionComplete();
      store.setDetectedFramework('React');
      store.setLoginUrl('url');
      store.setReadinessResult(null);
      store.setMcpComplete();
      store.setMcpSuggestedPromptsDismissed();
      store.setOutroDismissed();
      store.setSkillsComplete(true);
      store.setOutroData({ kind: OutroKind.Success });
      store.setFrameworkContext('k', 'v');
      store.setFrameworkConfig(null, null);

      expect(cb).toHaveBeenCalledTimes(14);
    });
  });

  // ── Setter analytics events ────────────────────────────────────

  describe('setter analytics events', () => {
    it('completeSetup fires setup confirmed event', () => {
      const store = createStore();
      store.completeSetup();
      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'setup confirmed',
        expect.any(Object),
      );
    });

    it('setCredentials fires auth complete event', () => {
      const store = createStore();
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 42,
      });
      expect(wizardCaptureMock).toHaveBeenCalledWith('auth complete', {
        project_id: 42,
      });
    });

    it('enableFeature fires feature enabled event', () => {
      const store = createStore();
      store.enableFeature(AdditionalFeature.LLM);
      expect(wizardCaptureMock).toHaveBeenCalledWith('feature enabled', {
        feature: AdditionalFeature.LLM,
      });
    });

    it('setMcpComplete fires mcp complete event', () => {
      const store = createStore();
      store.setMcpComplete(McpOutcome.Installed, ['Cursor', 'VS Code']);
      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'mcp complete',
        expect.objectContaining({
          mcp_outcome: McpOutcome.Installed,
          mcp_installed_clients: ['Cursor', 'VS Code'],
        }),
      );
    });

    it('setMcpComplete includes mcp_features_selected when installed', () => {
      const store = createStore();
      store.setMcpComplete(McpOutcome.Installed, ['Cursor'], 'all');
      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'mcp complete',
        expect.objectContaining({ mcp_features_selected: 'all' }),
      );

      wizardCaptureMock.mockClear();
      store.setMcpComplete(
        McpOutcome.Installed,
        ['Cursor'],
        ['dashboards', 'insights'],
      );
      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'mcp complete',
        expect.objectContaining({
          mcp_features_selected: ['dashboards', 'insights'],
        }),
      );
    });

    it('setMcpComplete omits mcp_features_selected when not installed', () => {
      const store = createStore();
      store.setMcpComplete(McpOutcome.Skipped, [], 'all');
      const call = wizardCaptureMock.mock.calls.find(
        ([event]) => event === 'mcp complete',
      );
      expect(call?.[1]).not.toHaveProperty('mcp_features_selected');
    });
  });

  // ── ScreenId resolution (derived state) ────────────────────────────

  describe('currentScreen', () => {
    it('starts at intro for Wizard flow', () => {
      const store = createStore();
      expect(store.currentScreen).toBe(ScreenId.Intro);
    });

    it('advances to health check after setup confirmed', () => {
      const store = createStore();
      store.completeSetup();
      expect(store.currentScreen).toBe(ScreenId.HealthCheck);
    });

    it('advances to auth after health check passes', () => {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      expect(store.currentScreen).toBe(ScreenId.Auth);
    });

    it('advances to run after credentials are set', () => {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 1,
      });
      expect(store.currentScreen).toBe(ScreenId.Run);
    });

    it('advances to outro after run completes', () => {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 1,
      });
      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(ScreenId.Outro);
    });

    it('advances to mcp after outro dismissed', () => {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 1,
      });
      store.setRunPhase(RunPhase.Completed);
      store.setOutroDismissed();
      expect(store.currentScreen).toBe(ScreenId.Mcp);
    });

    it('advances to skills after slack-connect dismissed', () => {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 1,
      });
      store.setRunPhase(RunPhase.Completed);
      store.setOutroDismissed();
      store.setMcpComplete();
      store.setSlackStepDismissed();
      expect(store.currentScreen).toBe(ScreenId.KeepSkills);
    });

    it('starts at McpAdd for McpAdd flow', () => {
      const store = createStore(Program.McpAdd);
      expect(store.currentScreen).toBe(ScreenId.McpAdd);
    });

    it('starts at McpRemove for McpRemove flow', () => {
      const store = createStore(Program.McpRemove);
      expect(store.currentScreen).toBe(ScreenId.McpRemove);
    });
  });

  // ── Overlay navigation ───────────────────────────────────────────

  describe('overlay navigation', () => {
    it('pushOverlay shows the overlay over the current screen', () => {
      const store = createStore();
      store.pushOverlay(Overlay.SettingsOverride);
      expect(store.currentScreen).toBe(Overlay.SettingsOverride);
    });

    it('popOverlay returns to the underlying screen', () => {
      const store = createStore();
      store.pushOverlay(Overlay.SettingsOverride);
      store.popOverlay();
      expect(store.currentScreen).toBe(ScreenId.Intro);
    });

    it('pushOverlay emits change and increments version', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.pushOverlay(Overlay.SettingsOverride);

      expect(cb).toHaveBeenCalledTimes(1);
      expect(store.getVersion()).toBe(1);
    });

    it('popOverlay emits change and increments version', () => {
      const store = createStore();
      store.pushOverlay(Overlay.SettingsOverride);

      const cb = vi.fn();
      store.subscribe(cb);
      store.popOverlay();

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('pushOverlay sets direction to push', () => {
      const store = createStore();
      store.pushOverlay(Overlay.SettingsOverride);
      expect(store.lastNavDirection).toBe('push');
    });

    it('popOverlay sets direction to pop', () => {
      const store = createStore();
      store.pushOverlay(Overlay.SettingsOverride);
      store.popOverlay();
      expect(store.lastNavDirection).toBe('pop');
    });
  });

  // ── wizard_ask overlay ───────────────────────────────────────────

  describe('requestQuestion / resolvePendingQuestion', () => {
    const pending = {
      id: 'req-1',
      source: 'creating-product-tours',
      questions: [
        { id: 'goal', prompt: 'Goal?', kind: 'text' as const },
        {
          id: 'audience',
          prompt: 'Who?',
          kind: 'single' as const,
          options: [
            { label: 'All users', value: 'all' },
            { label: 'New users', value: 'new' },
          ],
        },
      ],
    };

    it('requestQuestion pushes WizardAsk overlay and stores pending payload', () => {
      const store = createStore();
      void store.requestQuestion(pending);
      expect(store.currentScreen).toBe(Overlay.WizardAsk);
      expect(store.session.pendingQuestion).toEqual(pending);
    });

    it('resolvePendingQuestion resolves the promise with the answers and pops overlay', async () => {
      const store = createStore();
      const promise = store.requestQuestion(pending);

      store.resolvePendingQuestion({ goal: 'Find export', audience: 'new' });

      await expect(promise).resolves.toEqual({
        goal: 'Find export',
        audience: 'new',
      });
      expect(store.session.pendingQuestion).toBeNull();
      expect(store.currentScreen).not.toBe(Overlay.WizardAsk);
    });

    it('throws when requestQuestion is called while another is pending', () => {
      const store = createStore();
      void store.requestQuestion(pending);
      expect(() => store.requestQuestion(pending)).toThrow(
        /another wizard_ask request is pending/,
      );
    });

    it('cancelPendingQuestion resolves all fields with the cancelled sentinel', async () => {
      const store = createStore();
      const promise = store.requestQuestion(pending);

      store.cancelPendingQuestion();

      await expect(promise).resolves.toEqual({
        goal: '__cancelled__',
        audience: '__cancelled__',
      });
      expect(store.session.pendingQuestion).toBeNull();
    });

    it('cancelPendingQuestion is a no-op when nothing is pending', () => {
      const store = createStore();
      expect(() => store.cancelPendingQuestion()).not.toThrow();
      expect(store.session.pendingQuestion).toBeNull();
    });

    it('fires `wizard_ask shown` analytics with source, question_count, and kinds', () => {
      const store = createStore();
      void store.requestQuestion(pending);

      expect(wizardCaptureMock).toHaveBeenCalledWith('wizard_ask shown', {
        source: 'creating-product-tours',
        question_count: 2,
        kinds: ['text', 'single'],
      });
    });
  });

  // ── Agent observation state ──────────────────────────────────────

  describe('statusMessages', () => {
    it('pushStatus appends messages', () => {
      const store = createStore();
      store.pushStatus('Installing SDK...');
      store.pushStatus('Configuring...');
      expect(store.statusMessages).toEqual([
        'Installing SDK...',
        'Configuring...',
      ]);
    });

    it('pushStatus emits change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.pushStatus('msg');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('pushStatus caps history as a FIFO, dropping oldest', () => {
      const store = createStore();
      for (let i = 0; i < 250; i++) {
        store.pushStatus(`msg ${i}`);
      }

      // Cap is tied to EXPANDED_COUNT (the status bar's largest window).
      const msgs = store.statusMessages;
      expect(msgs).toHaveLength(EXPANDED_COUNT);
      // Newest retained, oldest dropped.
      expect(msgs[msgs.length - 1]).toBe('msg 249');
      expect(msgs[0]).toBe(`msg ${250 - EXPANDED_COUNT}`);
      expect(msgs).not.toContain('msg 0');
    });
  });

  describe('tasks', () => {
    it('setTasks replaces the task list', () => {
      const store = createStore();
      const tasks = [
        { label: 'Install SDK', status: TaskStatus.Pending, done: false },
        { label: 'Configure', status: TaskStatus.Pending, done: false },
      ];
      store.setTasks(tasks);
      expect(store.tasks).toEqual(tasks);
    });

    it('updateTask marks a task as done', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Install SDK', status: TaskStatus.Pending, done: false },
      ]);

      store.updateTask(0, true);

      expect(store.tasks[0].done).toBe(true);
      expect(store.tasks[0].status).toBe(TaskStatus.Completed);
    });

    it('updateTask marks a task as not done', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Install SDK', status: TaskStatus.Completed, done: true },
      ]);

      store.updateTask(0, false);

      expect(store.tasks[0].done).toBe(false);
      expect(store.tasks[0].status).toBe(TaskStatus.Pending);
    });

    it('updateTask is a no-op for out-of-bounds index', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Install SDK', status: TaskStatus.Pending, done: false },
      ]);

      const cb = vi.fn();
      store.subscribe(cb);
      store.updateTask(99, true);

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('syncTodos', () => {
    it('maps incoming todos to TaskItems', () => {
      const store = createStore();
      store.syncTodos([
        { content: 'Install SDK', status: 'pending' },
        { content: 'Configure', status: 'completed' },
      ]);

      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0]).toEqual({
        label: 'Install SDK',
        activeForm: undefined,
        status: TaskStatus.Pending,
        done: false,
      });
      expect(store.tasks[1]).toEqual({
        label: 'Configure',
        activeForm: undefined,
        status: TaskStatus.Completed,
        done: true,
      });
    });

    it('retains completed tasks not in the incoming list', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Old done task', status: TaskStatus.Completed, done: true },
        { label: 'Old pending task', status: TaskStatus.Pending, done: false },
      ]);

      store.syncTodos([{ content: 'New task', status: 'pending' }]);

      // Old done task is retained, old pending task is dropped
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0].label).toBe('Old done task');
      expect(store.tasks[1].label).toBe('New task');
    });

    it('does not duplicate completed tasks that appear in both', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Shared task', status: TaskStatus.Completed, done: true },
      ]);

      store.syncTodos([{ content: 'Shared task', status: 'completed' }]);

      // Should not have duplicates — incomingLabels includes "Shared task",
      // so the retained filter excludes it
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].label).toBe('Shared task');
    });

    it('preserves activeForm from incoming todos', () => {
      const store = createStore();
      store.syncTodos([
        {
          content: 'Installing',
          status: 'in_progress',
          activeForm: 'Installing SDK...',
        },
      ]);

      expect(store.tasks[0].activeForm).toBe('Installing SDK...');
    });

    it('emits change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);
      store.syncTodos([{ content: 'task', status: 'pending' }]);
      expect(cb).toHaveBeenCalled();
    });
  });

  // ── Navigation direction ─────────────────────────────────────────

  describe('lastNavDirection', () => {
    it('starts as null', () => {
      const store = createStore();
      expect(store.lastNavDirection).toBeNull();
    });

    it('is set to push on emitChange', () => {
      const store = createStore();
      store.emitChange();
      expect(store.lastNavDirection).toBe('push');
    });
  });

  // ── Concurrent / rapid-fire mutations ─────────────────────────────

  describe('concurrent mutations', () => {
    it('rapid-fire setters each increment version by 1', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.completeSetup();
      store.setRunPhase(RunPhase.Running);
      store.pushStatus('msg1');
      store.pushStatus('msg2');
      store.setDetectedFramework('React');

      expect(store.getVersion()).toBe(5);
      expect(cb).toHaveBeenCalledTimes(5);
    });

    it('subscriber sees consistent state during a setter call', () => {
      const store = createStore();
      const snapshots: { confirmed: boolean; version: number }[] = [];

      store.subscribe(() => {
        snapshots.push({
          confirmed: store.session.setupConfirmed,
          version: store.getSnapshot(),
        });
      });

      store.completeSetup();

      expect(snapshots).toEqual([{ confirmed: true, version: 1 }]);
    });

    it('multiple subscribers all see the same state', () => {
      const store = createStore();
      const results: number[] = [];

      store.subscribe(() => results.push(store.getSnapshot()));
      store.subscribe(() => results.push(store.getSnapshot()));
      store.subscribe(() => results.push(store.getSnapshot()));

      store.completeSetup();

      // All 3 subscribers should see version 1
      expect(results).toEqual([1, 1, 1]);
    });

    it('subscriber that mutates store during notification triggers additional notifications', () => {
      const store = createStore();
      const versions: number[] = [];

      // First subscriber triggers another mutation
      store.subscribe(() => {
        versions.push(store.getSnapshot());
        if (
          store.session.setupConfirmed &&
          store.session.runPhase === RunPhase.Idle
        ) {
          store.setRunPhase(RunPhase.Running);
        }
      });

      store.completeSetup();

      // Should see version 1 (from completeSetup) and version 2 (from setRunPhase)
      expect(versions).toEqual([1, 2]);
      expect(store.session.runPhase).toBe(RunPhase.Running);
    });

    it('interleaved overlay and session mutations are all visible', () => {
      const store = createStore();
      const screens: string[] = [];

      store.subscribe(() => {
        screens.push(store.currentScreen);
      });

      store.completeSetup(); // -> health-check
      store.pushOverlay(Overlay.SettingsOverride); // -> settings-override
      store.setCredentials({
        // -> settings-override (overlay still on top)
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 1,
      });
      store.popOverlay(); // -> health-check (readinessResult still null)

      expect(screens).toEqual([
        ScreenId.HealthCheck,
        Overlay.SettingsOverride,
        Overlay.SettingsOverride,
        ScreenId.HealthCheck,
      ]);
    });

    it('unsubscribing mid-notification does not affect other subscribers', () => {
      const store = createStore();
      const log: string[] = [];

      store.subscribe(() => {
        log.push('sub1');
      });

      const unsub2 = store.subscribe(() => {
        log.push('sub2');
      });

      store.subscribe(() => {
        log.push('sub3');
      });

      store.emitChange();
      expect(log).toEqual(['sub1', 'sub2', 'sub3']);

      // Unsub the second listener
      unsub2();
      log.length = 0;
      store.emitChange();
      expect(log).toEqual(['sub1', 'sub3']);
    });
  });

  // ── Multiple subscribers ─────────────────────────────────────────

  describe('multiple subscribers', () => {
    it('supports many concurrent subscribers', () => {
      const store = createStore();
      const callbacks = Array.from({ length: 50 }, () => vi.fn());
      const unsubs = callbacks.map((cb) => store.subscribe(cb));

      store.emitChange();

      callbacks.forEach((cb) => expect(cb).toHaveBeenCalledTimes(1));

      // Unsubscribe all
      unsubs.forEach((unsub) => unsub());
      store.emitChange();

      // No more notifications
      callbacks.forEach((cb) => expect(cb).toHaveBeenCalledTimes(1));
    });

    it('double-unsubscribe is safe', () => {
      const store = createStore();
      const cb = vi.fn();
      const unsub = store.subscribe(cb);

      unsub();
      unsub(); // should not throw

      store.emitChange();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('setFrameworkContext overwrites existing keys', () => {
      const store = createStore();
      store.setFrameworkContext('key', 'value1');
      store.setFrameworkContext('key', 'value2');
      expect(store.session.frameworkContext['key']).toBe('value2');
    });

    it('setFrameworkConfig with null integration and config', () => {
      const store = createStore();
      store.setFrameworkConfig(null, null);
      expect(store.session.integration).toBeNull();
      expect(store.session.frameworkConfig).toBeNull();
    });

    it('pushStatus with empty string', () => {
      const store = createStore();
      store.pushStatus('');
      expect(store.statusMessages).toEqual(['']);
    });

    it('syncTodos with empty array clears non-completed tasks', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Pending', status: TaskStatus.Pending, done: false },
        { label: 'Done', status: TaskStatus.Completed, done: true },
      ]);

      store.syncTodos([]);

      // Only the completed task is retained
      expect(store.tasks).toEqual([
        { label: 'Done', status: TaskStatus.Completed, done: true },
      ]);
    });

    it('syncTodos with unknown status defaults to Pending', () => {
      const store = createStore();
      store.syncTodos([{ content: 'Task', status: '' }]);
      expect(store.tasks[0].status).toBe(TaskStatus.Pending);
    });

    it('updateTask with negative index is a no-op', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Task', status: TaskStatus.Pending, done: false },
      ]);
      const cb = vi.fn();
      store.subscribe(cb);
      store.updateTask(-1, true);
      expect(cb).not.toHaveBeenCalled();
    });

    it('popOverlay on empty stack does not crash', () => {
      const store = createStore();
      expect(() => store.popOverlay()).not.toThrow();
      expect(store.currentScreen).toBe(ScreenId.Intro);
    });

    it('screen advances to outro on RunPhase.Error too', () => {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 1,
      });
      store.setRunPhase(RunPhase.Error);
      // Run is "complete" (either Completed or Error), so we advance past it
      expect(store.currentScreen).toBe(ScreenId.Outro);
    });

    it('completeSetup can only resolve the promise once', async () => {
      const store = createStore();
      store.completeSetup();
      store.completeSetup(); // second call — promise already resolved

      await store.getGate('intro');
      expect(store.session.setupConfirmed).toBe(true);
    });

    it('version property (string) is independent from internal _version counter', () => {
      const store = createStore();
      store.version = '1.2.3';
      expect(store.version).toBe('1.2.3');
      expect(store.getVersion()).toBe(0);

      store.emitChange();
      expect(store.version).toBe('1.2.3');
      expect(store.getVersion()).toBe(1);
    });
  });

  // ── Full wizard flow simulation ──────────────────────────────────

  describe('full wizard flow', () => {
    it('walks through the posthog integration flow correctly', () => {
      const store = createStore();
      const screenHistory: string[] = [];
      store.subscribe(() => screenHistory.push(store.currentScreen));

      expect(store.currentScreen).toBe(ScreenId.Intro);

      // Step 1: Confirm setup
      store.completeSetup();
      expect(store.currentScreen).toBe(ScreenId.HealthCheck);

      // Step 2: Health check passes
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      expect(store.currentScreen).toBe(ScreenId.Auth);

      // Step 3: Authenticate
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      });
      expect(store.currentScreen).toBe(ScreenId.Run);

      // Step 4: Start and complete run
      store.setRunPhase(RunPhase.Running);
      expect(store.currentScreen).toBe(ScreenId.Run);

      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(ScreenId.Outro);

      // Step 5: Dismiss outro
      store.setOutroDismissed();
      expect(store.currentScreen).toBe(ScreenId.Mcp);

      // Step 6: Complete MCP
      store.setMcpComplete();
      expect(store.currentScreen).toBe(ScreenId.SlackConnect);

      // Step 7: Dismiss the Connect-Slack step
      store.setSlackStepDismissed();
      expect(store.currentScreen).toBe(ScreenId.KeepSkills);

      // Verify version was bumped for each setter call
      expect(store.getVersion()).toBe(8);
    });

    it('walks through the revenue analytics flow correctly', () => {
      const store = createStore(Program.RevenueAnalyticsSetup);

      expect(store.currentScreen).toBe(ScreenId.RevenueIntro);

      // Step 1: Confirm intro
      store.completeSetup();
      expect(store.currentScreen).toBe(ScreenId.HealthCheck);

      // Step 2: Clear the health-check screen with a healthy readiness result
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      expect(store.currentScreen).toBe(ScreenId.Auth);

      // Step 3: Authenticate
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      });
      expect(store.currentScreen).toBe(ScreenId.Run);

      // Step 4: Start and complete run
      store.setRunPhase(RunPhase.Running);
      expect(store.currentScreen).toBe(ScreenId.Run);

      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(ScreenId.Outro);

      // Step 5: Dismiss outro
      store.setOutroDismissed();
      expect(store.currentScreen).toBe('keep-skills');
    });

    it('walks through the agent skill flow correctly', () => {
      const store = createStore(Program.AgentSkill);

      expect(store.currentScreen).toBe(ScreenId.AgentSkillIntro);

      // Step 1: Confirm intro
      store.completeSetup();
      expect(store.currentScreen).toBe(ScreenId.HealthCheck);

      // Step 2: Clear the health-check screen with a healthy readiness result
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      expect(store.currentScreen).toBe(ScreenId.Auth);

      // Step 3: Authenticate
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('https://app.posthog.com'),
        projectId: 1,
      });
      expect(store.currentScreen).toBe(ScreenId.Run);

      // Step 4: Start and complete run
      store.setRunPhase(RunPhase.Running);
      expect(store.currentScreen).toBe(ScreenId.Run);

      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(ScreenId.Outro);

      // Step 5: Dismiss outro
      store.setOutroDismissed();
      expect(store.currentScreen).toBe('keep-skills');
    });
  });

  // ── health-check gate ────────────────────────────────────────────

  describe('health-check gate', () => {
    it('resolves immediately for non-Wizard flows', async () => {
      const store = createStore(Program.McpAdd);

      await expect(store.getGate('health-check')).resolves.toBeUndefined();
    });

    it('resolves automatically when readiness is non-blocking', async () => {
      evaluateWizardReadinessMock.mockResolvedValueOnce({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });

      const store = createStore();
      store.runInitHooks();
      let resolved = false;

      void store.getGate('health-check').then(() => {
        resolved = true;
      });

      await flushMicrotasks();

      expect(resolved).toBe(true);
      expect(store.session.readinessResult).toEqual({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
    });

    it('stays pending for blocking readiness until outage is dismissed', async () => {
      evaluateWizardReadinessMock.mockResolvedValueOnce({
        decision: WizardReadiness.No,
        health: {} as never,
        reasons: ['Anthropic: down'],
      });

      const store = createStore();
      store.runInitHooks();
      let resolved = false;

      void store.getGate('health-check').then(() => {
        resolved = true;
      });

      await flushMicrotasks();

      expect(resolved).toBe(false);
      expect(store.currentScreen).toBe(ScreenId.Intro);

      store.dismissOutage();
      await store.getGate('health-check');

      expect(resolved).toBe(true);
      expect(store.session.outageDismissed).toBe(true);
    });
  });

  // ── ScreenId transition analytics ───────────────────────────────────

  describe('screen transition analytics', () => {
    it('fires when a real screen transition occurs after the initial screen', () => {
      const store = createStore();

      store.completeSetup();
      wizardCaptureMock.mockClear();

      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });

      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'screen auth',
        expect.objectContaining({
          from_screen: ScreenId.HealthCheck,
        }),
      );
    });

    it('does not fire a screen event when the visible screen stays the same', () => {
      const store = createStore();
      store.completeSetup();
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: HostResolution.fromApiHost('h'),
        projectId: 1,
      });
      wizardCaptureMock.mockClear();

      store.setRunPhase(RunPhase.Running);

      expect(store.currentScreen).toBe(ScreenId.Run);
      expect(
        wizardCaptureMock.mock.calls.some(
          ([event]) => typeof event === 'string' && event.startsWith('screen '),
        ),
      ).toBe(false);
    });
  });

  // ── intro gate ──────────────────────────────────────────────────

  describe('intro gate', () => {
    it('resolves when completeSetup is called', async () => {
      const store = createStore();
      store.completeSetup();
      await store.getGate('intro');
      expect(store.session.setupConfirmed).toBe(true);
    });

    it('is a promise that can be awaited before completeSetup is called', async () => {
      const store = createStore();

      let resolved = false;
      void store.getGate('intro').then(() => {
        resolved = true;
      });

      // Not yet resolved
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(false);

      store.completeSetup();
      await store.getGate('intro');
      expect(resolved).toBe(true);
    });
  });

  describe('setIntegrate (self-driving integration check)', () => {
    it('records "no" as integrate=true', () => {
      const store = createStore(Program.SelfDriving);
      store.session = buildSession({});
      store.setIntegrate(true);
      expect(store.session.integrate).toBe(true);
    });

    it('records "yes, already integrated" as integrate=false', () => {
      const store = createStore(Program.SelfDriving);
      store.session = buildSession({});
      store.setIntegrate(false);
      expect(store.session.integrate).toBe(false);
    });

    it('defaults to null (undecided) before the question', () => {
      expect(buildSession({}).integrate).toBeNull();
    });

    it('--integrate pre-resolves the decision to true', () => {
      expect(buildSession({ integrate: true }).integrate).toBe(true);
    });
  });
});
