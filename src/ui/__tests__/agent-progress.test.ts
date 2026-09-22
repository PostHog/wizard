vi.mock('@ui', () => ({ getUI: vi.fn() }));
vi.mock('@utils/debug');

import { createUiReducer, uiInteraction } from '../agent-progress';
import { LoggingUI } from '@headless/renderers/logging-ui';
import type { AgentProgress } from '@agent/progress';
import { OutroKind } from '@lib/wizard-session';

it('projects every progress event onto the matching UI call, in order', () => {
  const ui = new LoggingUI();
  const calls: unknown[][] = [];
  const methods = [
    'startRun',
    'outro',
    'pushStatus',
    'syncTodos',
    'setStage',
    'setDashboardUrl',
    'setNotebookUrl',
    'addTokenUsage',
    'setFinalTokenCostUsd',
    'showAuthError',
    'setHandoffText',
    'setOutroData',
  ] as const;
  for (const method of methods) {
    vi.spyOn(ui, method).mockImplementation(((...args: unknown[]) => {
      calls.push([method, ...args]);
    }) as never);
  }
  for (const level of ['info', 'warn', 'error', 'success', 'step'] as const) {
    vi.spyOn(ui.log, level).mockImplementation((message) => {
      calls.push([level, message]);
    });
  }
  const spinner = vi.spyOn(ui, 'spinner').mockReturnValue({
    start: (message) => {
      calls.push(['spinner:start', message]);
    },
    message: (message) => {
      calls.push(['spinner:message', message]);
    },
    stop: (message) => {
      calls.push(['spinner:stop', message]);
    },
  });
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
  const events: AgentProgress[] = [
    { kind: 'lifecycle', phase: 'started' },
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
  const reduce = createUiReducer(ui);
  expect(spinner).not.toHaveBeenCalled();
  events.forEach(reduce);
  expect(spinner).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([
    ['startRun'],
    ['spinner:start', 'Starting'],
    ['spinner:message', 'Working'],
    ['spinner:stop', undefined],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['success', 'success'],
    ['step', 'step'],
    ['pushStatus', 'Configured'],
    ['syncTodos', tasks],
    ['setStage', 'Install'],
    ['setDashboardUrl', 'https://d/1'],
    ['setNotebookUrl', 'https://n/1'],
    ['addTokenUsage', delta],
    ['setFinalTokenCostUsd', 1.25],
    ['showAuthError', detail],
    ['setHandoffText', '# Report'],
    ['setOutroData', outro],
    ['outro', 'Finished'],
  ]);
});

it('forwards answers, notices and their dismissals', async () => {
  const ui = new LoggingUI();
  const question = { id: 'q', source: 'test', questions: [] };
  const notice = {
    title: 'Optional',
    body: [],
    items: [],
    prompt: 'Continue?',
    confirmLabel: 'Yes',
    cancelLabel: 'No',
  };
  const ask = vi.spyOn(ui, 'requestQuestion').mockResolvedValue({ q: 'yes' });
  const cancelAsk = vi.spyOn(ui, 'cancelPendingQuestion');
  const show = vi.spyOn(ui, 'showTaskNotice').mockResolvedValue(true);
  const cancelNotice = vi.spyOn(ui, 'cancelTaskNotice');
  const interaction = uiInteraction(ui);
  await expect(interaction.ask?.(question)).resolves.toEqual({ q: 'yes' });
  await expect(interaction.taskNotice?.(notice)).resolves.toBe(true);
  interaction.cancelAsk?.();
  interaction.cancelTaskNotice?.();
  expect(ask).toHaveBeenCalledWith(question);
  expect(show).toHaveBeenCalledWith(notice);
  expect(cancelAsk).toHaveBeenCalledOnce();
  expect(cancelNotice).toHaveBeenCalledOnce();
});
