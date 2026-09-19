import { HostResolution } from '../../host-resolution.js';
import { OutroKind, RunPhase } from '../../session/wizard-session.js';
import { createControlledStore } from '../../testing/index.js';

describe('resetRunState', () => {
  it('clears exactly what one run produced and keeps what the next run needs', async () => {
    const store = createControlledStore();
    store.setCredentials({
      accessToken: 't',
      projectApiKey: 'k',
      host: HostResolution.fromApiHost('https://us.posthog.com'),
      projectId: 3,
    });
    store.setFrameworkContext('router', 'app');
    store.completeRunStep('earlier');
    store.setTasks([
      { label: 'Install', status: 'completed', done: true } as never,
    ]);
    store.pushStatus('installing');
    store.setEventPlan([{ name: 'signup', description: 'd' }]);
    store.setHandoffText('prompt');
    store.setCurrentStage('verify' as never);
    store.setRunPhase(RunPhase.Completed);
    store.setOutroData({ kind: OutroKind.Success, message: 'ok' });
    store.setOutroDismissed();
    store.setDashboardUrl('https://us.posthog.com/d/1');
    const question = store.requestQuestion({
      id: 'q',
      source: 'test',
      questions: [{ id: 'a', prompt: 'A?', kind: 'text' }],
    } as never);
    const notice = store.showTaskNotice({
      title: 't',
      body: [],
      confirmLabel: 'y',
      cancelLabel: 'n',
      prompt: 'p',
    });

    const version = store.getVersion();
    store.resetRunState();

    expect(store.tasks).toEqual([]);
    expect(store.statusMessages).toEqual([]);
    expect(store.eventPlan).toEqual([]);
    expect(store.handoffText).toBeNull();
    expect(store.currentStage).toBeNull();
    expect(store.session).toMatchObject({
      runPhase: RunPhase.Idle,
      outroData: null,
      outroDismissed: false,
      dashboardUrl: null,
      notebookUrl: null,
      pendingQuestion: null,
      taskNotice: null,
    });
    await expect(question).resolves.toEqual({ a: '__cancelled__' });
    await expect(notice).resolves.toBe(false);

    expect(store.session.credentials?.projectId).toBe(3);
    expect(store.session.frameworkContext).toEqual({ router: 'app' });
    expect(store.session.completedRuns).toContain('earlier');
    expect(store.getVersion()).toBeGreaterThan(version);
  });
});
