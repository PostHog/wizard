// Load @ui first so the logging-ui → readiness → debug → @ui import cycle
// resolves in the order the app uses (@ui before logging-ui). Importing
// HeadlessUI as the entry otherwise hits `new LoggingUI()` in @ui before
// logging-ui has finished initializing.
import '@ui';
import { HeadlessUI } from '../headless-ui';
import { TaskStatus } from '../wizard-ui';
import type { WizardStore } from '../tui/store';

describe('HeadlessUI', () => {
  it('forwards task updates to the store and still logs to the console', () => {
    const syncTodos = vi.fn();
    const store = { syncTodos } as unknown as WizardStore;
    const ui = new HeadlessUI(store);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const todos = [
      {
        content: 'Install SDK',
        status: TaskStatus.InProgress,
        activeForm: 'Installing SDK',
      },
      { content: 'Done', status: TaskStatus.Completed },
    ];
    ui.syncTodos(todos);

    expect(syncTodos).toHaveBeenCalledWith(todos);
    // LoggingUI.syncTodos logs the active task line, so console output is kept.
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});

it.each(['headless', 'interactive'])(
  'publishes every committed %s task state independently of legacy coalescing',
  async (mode) => {
    const { WizardStore } = await import('../tui/store');
    const { InkUI } = await import('../tui/ink-ui');
    const { TaskStreamPush } = await import(
      '@lib/task-stream/task-stream-push'
    );
    const { WizardRunSync } = await import('@lib/task-stream/wizard-run-sync');
    const { HostResolution } = await import('@shared/host-resolution');
    const { RunPhase } = await import('@lib/wizard-session');
    const store = new WizardStore();
    store.setCredentials({
      accessToken: 'pha_test',
      projectId: 42,
      projectApiKey: 'phc_unused',
      host: HostResolution.fromApiHost('https://eu.posthog.com'),
    });
    const ui = mode === 'headless' ? new HeadlessUI(store) : new InkUI(store);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const legacy = {
      name: 'legacy',
      send: vi.fn().mockRejectedValue(new Error('legacy unavailable')),
    };
    const runSync = new WizardRunSync({
      mode: 'cloud',
      assignedId: '019edb1a-cce4-4000-8f6d-682061862da9',
      programId: 'posthog-integration',
      getSession: () => store.session,
      fetchImpl,
    });
    const stream = new TaskStreamPush({
      store,
      programId: 'onboarding',
      destinations: [legacy],
      runSync,
    });
    stream.attach();
    ui.startRun();
    for (const status of ['pending', 'in_progress', 'completed']) {
      ui.syncTodos([{ id: 'task-1', content: 'Inspect', status }]);
    }
    ui.setAccessToken(store.session.credentials!);
    store.setRunPhase(RunPhase.Completed);
    await stream.shutdown(2000, 'completed');
    expect(
      fetchImpl.mock.calls.map(([, init]) => JSON.parse(init!.body as string)),
    ).toEqual([
      { tasks: [] },
      ...['created', 'running', 'completed'].map((status) => ({
        tasks: [{ name: 'Inspect', status }],
      })),
    ]);
    expect(legacy.send).toHaveBeenCalled();
  },
);
