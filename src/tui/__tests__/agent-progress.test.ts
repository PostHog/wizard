vi.mock(import('@utils/debug'));
vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn(), setTag: vi.fn() } as never,
  sessionProperties: vi.fn(() => ({})),
}));

import { scanProgress } from '@tui/agent-progress';
import type { AgentProgress } from '@agent/types';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';

it('writes every scan progress event to the store, in order', async () => {
  const { WizardStore } = await import('@tui/store');
  const { Overlay } = await import('@tui/router');
  const { Program } = await import('@programs');
  const store = new WizardStore(Program.PostHogIntegration);
  const tasks = [{ content: 'Install', status: 'completed' }];
  const delta = {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    cacheCreation5m: 4,
    cacheCreation1h: 0,
  };
  const detail = { hasSettingsConflict: false, logFilePath: '/tmp/wizard.log' };
  const outro = { kind: OutroKind.Success, message: 'Finished' };
  const reduce = scanProgress(store);

  reduce({ kind: 'lifecycle', phase: 'started' });
  expect(store.session.runPhase).toBe(RunPhase.Running);

  const events: AgentProgress[] = [
    { kind: 'spinner', action: 'start', message: 'Starting' },
    { kind: 'spinner', action: 'message', message: 'Working' },
    { kind: 'spinner', action: 'stop' },
    ...(['info', 'warn', 'error', 'success', 'step'] as const).map((level) => ({
      kind: 'log' as const,
      level,
      message: level,
    })),
    { kind: 'status', message: 'Configured' },
    { kind: 'tasks', tasks },
    { kind: 'stage', stage: 'Install' },
    { kind: 'url', which: 'dashboard', url: 'https://d/1' },
    { kind: 'url', which: 'notebook', url: 'https://n/1' },
    { kind: 'usage', delta },
    { kind: 'finalCost', usd: 1.25 },
    { kind: 'authError', detail },
    { kind: 'handoff', text: '# Report' },
    { kind: 'completion', outro },
    { kind: 'lifecycle', phase: 'completed', message: 'Finished' },
  ];
  events.forEach(reduce);

  expect(store.session.runPhase).toBe(RunPhase.Completed);
  expect(store.statusMessages).toEqual([
    'Starting',
    'Working',
    'info',
    'warn',
    'error',
    'success',
    'step',
    'Configured',
    'Finished',
  ]);
  expect(store.tasks).toMatchObject([
    { label: 'Install', status: 'completed', done: true },
  ]);
  expect(store.currentStage?.stage).toBe('Install');
  expect(store.session.dashboardUrl).toBe('https://d/1');
  expect(store.session.notebookUrl).toBe('https://n/1');
  expect(store.tokenUsage).toMatchObject({
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    costUsd: 1.25,
    costIsFinal: true,
  });
  expect(store.currentScreen).toBe(Overlay.AuthError);
  expect(store.authErrorDetail).toEqual(detail);
  expect(store.handoffText).toBe('# Report');
  // The URLs the agent emitted land on the outro.
  expect(store.session.outroData).toEqual({
    ...outro,
    dashboardUrl: 'https://d/1',
    notebookUrl: 'https://n/1',
  });
});

it("shows a runProgram run's display events and leaves its run state to the session store", async () => {
  const { displayProgress } = await import('@tui/agent-progress');
  const { WizardStore } = await import('@tui/store');
  const { Program } = await import('@programs');
  const store = new WizardStore(Program.PostHogIntegration);
  const show = displayProgress(store);
  const events: AgentProgress[] = [
    // Run state: runProgram records these in the session store itself.
    { kind: 'status', message: 'Installing' },
    { kind: 'tasks', tasks: [{ content: 'Install SDK', status: 'pending' }] },
    { kind: 'url', which: 'dashboard', url: 'https://d/1' },
    { kind: 'handoff', text: '# Report' },
    { kind: 'completion', outro: { kind: OutroKind.Success, message: 'Done' } },
    // Display only.
    { kind: 'log', level: 'info', message: 'Reading files' },
    { kind: 'stage', stage: 'Install' },
  ];
  for (const event of events) show({ runId: 'run-1', event });
  expect(store.statusMessages).toEqual(['Reading files']);
  expect(store.tasks).toEqual([]);
  expect(store.session.dashboardUrl).toBeNull();
  expect(store.handoffText).toBeNull();
  expect(store.session.outroData).toBeNull();
  expect(store.currentStage?.stage).toBe('Install');
});
