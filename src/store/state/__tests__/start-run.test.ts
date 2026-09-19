import { HostResolution } from '../../host-resolution.js';
import { OutroKind, RunPhase } from '../../session/wizard-session.js';
import { createControlledStore } from '../../testing/index.js';

describe('startRun', () => {
  it('starts a fresh run store and keeps what the next run needs on the flow', async () => {
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

    const previous = store.run;
    const version = store.getVersion();
    const run = store.startRun({ ...store.session, installDir: '/tmp/scoped' });

    expect(run).not.toBe(previous);
    expect(store.run).toBe(run);
    // The run's own copy is scoped; the flow keeps its own install dir.
    expect(run.session.installDir).toBe('/tmp/scoped');
    expect(store.session.installDir).toBe('/tmp/controlled-store');
    expect(store.tasks).toEqual([]);
    expect(store.statusMessages).toEqual([]);
    expect(store.eventPlan).toEqual([]);
    expect(store.handoffText).toBeNull();
    expect(store.currentStage).toBeNull();
    expect(store.session).toMatchObject({
      runPhase: RunPhase.Idle,
      outroData: null,
      outroDismissed: false,
      pendingQuestion: null,
      taskNotice: null,
    });
    expect(store.hasInterrupt).toBe(false);
    await expect(question).resolves.toEqual({ a: '__cancelled__' });
    await expect(notice).resolves.toBe(false);

    expect(store.session.credentials?.projectId).toBe(3);
    expect(run.session.credentials?.projectId).toBe(3);
    expect(store.session.frameworkContext).toEqual({ router: 'app' });
    expect(store.session.completedRuns).toContain('earlier');
    // Artefacts a run created for the project outlive it: the flow's outro links them.
    expect(store.session.dashboardUrl).toBe('https://us.posthog.com/d/1');
    expect(run.session.dashboardUrl).toBe('https://us.posthog.com/d/1');
    expect(store.getVersion()).toBeGreaterThan(version);
  });

  it('mirrors the active run and only the active run', () => {
    const store = createControlledStore();
    const run = store.startRun(store.session);
    const before = store.getVersion();
    run.setRunPhase(RunPhase.Running);
    run.pushStatus('working');
    expect(store.getVersion()).toBeGreaterThan(before);
    expect(store.session.runPhase).toBe(RunPhase.Running);
    expect(store.statusMessages).toEqual(['working']);

    const stale = run;
    store.startRun(store.session);
    const after = store.getVersion();
    stale.pushStatus('from the old run');
    stale.setRunPhase(RunPhase.Error);
    expect(store.getVersion()).toBe(after);
    expect(store.statusMessages).toEqual([]);
    expect(store.session.runPhase).toBe(RunPhase.Idle);
  });

  it('writes context and skill to the flow and to the run the agent is in', () => {
    const store = createControlledStore();
    const run = store.startRun(store.session);
    store.setFrameworkContext('picked', 'yes');
    store.setSkillId('nextjs');
    expect(run.session.frameworkContext.picked).toBe('yes');
    expect(store.session.frameworkContext.picked).toBe('yes');
    expect(run.session.skillId).toBe('nextjs');
    expect(store.session.skillId).toBe('nextjs');
  });
});
