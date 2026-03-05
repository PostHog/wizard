import {
  WizardStore,
  TaskStatus,
  Flow,
  Screen,
  Overlay,
  RunPhase,
} from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { buildSession } from '../../../lib/wizard-session.js';
import { Integration } from '../../../lib/constants.js';

function createStore(flow?: Flow): WizardStore {
  return new WizardStore(flow);
}

describe('WizardStore', () => {
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
      expect(store.router.activeFlow).toBe(Flow.Wizard);
    });

    it('accepts a custom flow', () => {
      const store = createStore(Flow.McpAdd);
      expect(store.router.activeFlow).toBe(Flow.McpAdd);
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
      const listener = jest.fn();
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
      const cb = jest.fn();
      store.subscribe(cb);

      store.emitChange();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('subscribe returns an unsubscribe function', () => {
      const store = createStore();
      const cb = jest.fn();
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
      const cb = jest.fn();
      const unsub = store.subscribe(cb);

      const v1 = store.getSnapshot();
      store.setCloudRegion('us');
      const v2 = store.getSnapshot();

      expect(v2).toBeGreaterThan(v1);
      expect(cb).toHaveBeenCalled();
      unsub();
    });
  });

  // ── Session setters ──────────────────────────────────────────────

  describe('session setters', () => {
    it('setCloudRegion updates session and emits change', () => {
      const store = createStore();
      const cb = jest.fn();
      store.subscribe(cb);

      store.setCloudRegion('eu');

      expect(store.session.cloudRegion).toBe('eu');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('completeSetup sets region and resolves setupComplete promise', async () => {
      const store = createStore();
      const cb = jest.fn();
      store.subscribe(cb);

      store.completeSetup('us');

      expect(store.session.cloudRegion).toBe('us');
      const result = await store.setupComplete;
      expect(result).toBe('us');
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
        host: 'https://app.posthog.com',
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

    it('setServiceStatus sets status info', () => {
      const store = createStore();
      const status = {
        description: 'Major outage',
        statusPageUrl: 'https://status.posthog.com',
      };
      store.setServiceStatus(status);
      expect(store.session.serviceStatus).toEqual(status);

      store.setServiceStatus(null);
      expect(store.session.serviceStatus).toBeNull();
    });

    it('setMcpComplete marks MCP step done', () => {
      const store = createStore();
      expect(store.session.mcpComplete).toBe(false);
      store.setMcpComplete();
      expect(store.session.mcpComplete).toBe(true);
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
      const cb = jest.fn();
      store.subscribe(cb);

      store.setCloudRegion('us');
      store.setRunPhase(RunPhase.Running);
      store.setCredentials(null);
      store.setDetectionComplete();
      store.setDetectedFramework('React');
      store.setLoginUrl('url');
      store.setServiceStatus(null);
      store.setMcpComplete();
      store.setOutroData({ kind: OutroKind.Success });
      store.setFrameworkContext('k', 'v');
      store.setFrameworkConfig(null, null);

      expect(cb).toHaveBeenCalledTimes(11);
    });
  });

  // ── Screen resolution (derived state) ────────────────────────────

  describe('currentScreen', () => {
    it('starts at intro for Wizard flow', () => {
      const store = createStore();
      expect(store.currentScreen).toBe(Screen.Intro);
    });

    it('advances to auth after region is set', () => {
      const store = createStore();
      store.setCloudRegion('us');
      expect(store.currentScreen).toBe(Screen.Auth);
    });

    it('advances to run after credentials are set', () => {
      const store = createStore();
      store.setCloudRegion('us');
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        projectId: 1,
      });
      expect(store.currentScreen).toBe(Screen.Run);
    });

    it('advances to mcp after run completes', () => {
      const store = createStore();
      store.setCloudRegion('us');
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        projectId: 1,
      });
      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(Screen.Mcp);
    });

    it('advances to outro after mcp completes', () => {
      const store = createStore();
      store.setCloudRegion('us');
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        projectId: 1,
      });
      store.setRunPhase(RunPhase.Completed);
      store.setMcpComplete();
      expect(store.currentScreen).toBe(Screen.Outro);
    });

    it('starts at McpAdd for McpAdd flow', () => {
      const store = createStore(Flow.McpAdd);
      expect(store.currentScreen).toBe(Screen.McpAdd);
    });

    it('starts at McpRemove for McpRemove flow', () => {
      const store = createStore(Flow.McpRemove);
      expect(store.currentScreen).toBe(Screen.McpRemove);
    });
  });

  // ── Overlay navigation ───────────────────────────────────────────

  describe('overlay navigation', () => {
    it('pushOverlay shows the overlay over the current screen', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      expect(store.currentScreen).toBe(Overlay.Outage);
    });

    it('popOverlay returns to the underlying screen', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      store.popOverlay();
      expect(store.currentScreen).toBe(Screen.Intro);
    });

    it('pushOverlay emits change and increments version', () => {
      const store = createStore();
      const cb = jest.fn();
      store.subscribe(cb);

      store.pushOverlay(Overlay.Outage);

      expect(cb).toHaveBeenCalledTimes(1);
      expect(store.getVersion()).toBe(1);
    });

    it('popOverlay emits change and increments version', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);

      const cb = jest.fn();
      store.subscribe(cb);
      store.popOverlay();

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('pushOverlay sets direction to push', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      expect(store.lastNavDirection).toBe('push');
    });

    it('popOverlay sets direction to pop', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      store.popOverlay();
      expect(store.lastNavDirection).toBe('pop');
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
      const cb = jest.fn();
      store.subscribe(cb);

      store.pushStatus('msg');
      expect(cb).toHaveBeenCalledTimes(1);
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

      const cb = jest.fn();
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
      const cb = jest.fn();
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
      const cb = jest.fn();
      store.subscribe(cb);

      store.setCloudRegion('us');
      store.setRunPhase(RunPhase.Running);
      store.pushStatus('msg1');
      store.pushStatus('msg2');
      store.setDetectedFramework('React');

      expect(store.getVersion()).toBe(5);
      expect(cb).toHaveBeenCalledTimes(5);
    });

    it('subscriber sees consistent state during a setter call', () => {
      const store = createStore();
      const snapshots: { region: string | null; version: number }[] = [];

      store.subscribe(() => {
        snapshots.push({
          region: store.session.cloudRegion,
          version: store.getSnapshot(),
        });
      });

      store.setCloudRegion('eu');

      expect(snapshots).toEqual([{ region: 'eu', version: 1 }]);
    });

    it('multiple subscribers all see the same state', () => {
      const store = createStore();
      const results: number[] = [];

      store.subscribe(() => results.push(store.getSnapshot()));
      store.subscribe(() => results.push(store.getSnapshot()));
      store.subscribe(() => results.push(store.getSnapshot()));

      store.setCloudRegion('us');

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
          store.session.cloudRegion === 'us' &&
          store.session.runPhase === RunPhase.Idle
        ) {
          store.setRunPhase(RunPhase.Running);
        }
      });

      store.setCloudRegion('us');

      // Should see version 1 (from setCloudRegion) and version 2 (from setRunPhase)
      expect(versions).toEqual([1, 2]);
      expect(store.session.runPhase).toBe(RunPhase.Running);
    });

    it('interleaved overlay and session mutations are all visible', () => {
      const store = createStore();
      const screens: string[] = [];

      store.subscribe(() => {
        screens.push(store.currentScreen);
      });

      store.setCloudRegion('us'); // -> auth
      store.pushOverlay(Overlay.Outage); // -> outage
      store.setCredentials({
        // -> outage (overlay still on top)
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        projectId: 1,
      });
      store.popOverlay(); // -> run

      expect(screens).toEqual([
        Screen.Auth,
        Overlay.Outage,
        Overlay.Outage,
        Screen.Run,
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
      const callbacks = Array.from({ length: 50 }, () => jest.fn());
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
      const cb = jest.fn();
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
      const cb = jest.fn();
      store.subscribe(cb);
      store.updateTask(-1, true);
      expect(cb).not.toHaveBeenCalled();
    });

    it('popOverlay on empty stack does not crash', () => {
      const store = createStore();
      expect(() => store.popOverlay()).not.toThrow();
      expect(store.currentScreen).toBe(Screen.Intro);
    });

    it('screen advances to outro on RunPhase.Error too', () => {
      const store = createStore();
      store.setCloudRegion('us');
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        projectId: 1,
      });
      store.setRunPhase(RunPhase.Error);
      // Run is "complete" (either Completed or Error), so we advance past it
      expect(store.currentScreen).toBe(Screen.Mcp);
    });

    it('completeSetup can only resolve the promise once', async () => {
      const store = createStore();
      store.completeSetup('us');
      store.completeSetup('eu'); // second call — region updates but promise already resolved

      const result = await store.setupComplete;
      expect(result).toBe('us'); // first resolution wins
      expect(store.session.cloudRegion).toBe('eu'); // but session reflects latest
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
    it('walks through the entire wizard flow correctly', () => {
      const store = createStore();
      const screenHistory: string[] = [];
      store.subscribe(() => screenHistory.push(store.currentScreen));

      expect(store.currentScreen).toBe(Screen.Intro);

      // Step 1: Pick region
      store.completeSetup('us');
      expect(store.currentScreen).toBe(Screen.Auth);

      // Step 2: Authenticate
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://app.posthog.com',
        projectId: 1,
      });
      expect(store.currentScreen).toBe(Screen.Run);

      // Step 3: Start and complete run
      store.setRunPhase(RunPhase.Running);
      expect(store.currentScreen).toBe(Screen.Run);

      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(Screen.Mcp);

      // Step 4: Complete MCP
      store.setMcpComplete();
      expect(store.currentScreen).toBe(Screen.Outro);

      // Verify version was bumped for each setter call
      expect(store.getVersion()).toBe(5);
    });
  });

  // ── setupComplete promise ────────────────────────────────────────

  describe('setupComplete', () => {
    it('resolves with the region passed to completeSetup', async () => {
      const store = createStore();
      store.completeSetup('eu');
      await expect(store.setupComplete).resolves.toBe('eu');
    });

    it('is a promise that can be awaited before completeSetup is called', async () => {
      const store = createStore();

      let resolved = false;
      void store.setupComplete.then(() => {
        resolved = true;
      });

      // Not yet resolved
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(false);

      store.completeSetup('us');
      await store.setupComplete;
      expect(resolved).toBe(true);
    });
  });
});
