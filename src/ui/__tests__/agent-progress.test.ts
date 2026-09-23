vi.mock('@ui', () => ({ getUI: vi.fn() }));
vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({ analytics: { wizardCapture: vi.fn() } }));

import { createUiReducer, uiInteraction } from '../agent-progress';
import { LoggingUI } from '../logging-ui';
import type { AgentProgress } from '@agent/progress';
import {
  CANCELLED_SENTINEL,
  createWizardAskBridge,
} from '@agent/wizard-ask-bridge';
import { OutroKind } from '@lib/wizard-session';
import { logToFile } from '@utils/debug';

beforeEach(() => {
  vi.mocked(logToFile).mockClear();
});

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

const question = { id: 'q', source: 'test', questions: [] };
const notice = {
  title: 'Optional',
  body: [],
  items: [],
  prompt: 'Continue?',
  confirmLabel: 'Yes',
  cancelLabel: 'No',
};

it('forwards answers and notices, leaving the host alone once they settle', async () => {
  const ui = new LoggingUI();
  const ask = vi.spyOn(ui, 'requestQuestion').mockResolvedValue({ q: 'yes' });
  const cancelAsk = vi.spyOn(ui, 'cancelPendingQuestion');
  const show = vi.spyOn(ui, 'showTaskNotice').mockResolvedValue(true);
  const cancelNotice = vi.spyOn(ui, 'cancelTaskNotice');
  const interaction = uiInteraction(ui);
  const asked = new AbortController();
  const noticed = new AbortController();
  await expect(
    interaction.ask?.(question, { signal: asked.signal }),
  ).resolves.toEqual({ q: 'yes' });
  await expect(
    interaction.taskNotice?.(notice, { signal: noticed.signal }),
  ).resolves.toBe(true);
  // A late abort must not dismiss whatever the host shows next.
  asked.abort();
  noticed.abort();
  expect(ask).toHaveBeenCalledWith(question);
  expect(show).toHaveBeenCalledWith(notice);
  expect(cancelAsk).not.toHaveBeenCalled();
  expect(cancelNotice).not.toHaveBeenCalled();
});

it('dismisses an open question or notice when its signal aborts', () => {
  const ui = new LoggingUI();
  vi.spyOn(ui, 'requestQuestion').mockReturnValue(new Promise(() => undefined));
  const cancelAsk = vi.spyOn(ui, 'cancelPendingQuestion');
  vi.spyOn(ui, 'showTaskNotice').mockReturnValue(new Promise(() => undefined));
  const cancelNotice = vi.spyOn(ui, 'cancelTaskNotice');
  const interaction = uiInteraction(ui);
  const asked = new AbortController();
  const noticed = new AbortController();
  void interaction.ask?.(question, { signal: asked.signal });
  void interaction.taskNotice?.(notice, { signal: noticed.signal });

  asked.abort();
  expect(cancelAsk).toHaveBeenCalledOnce();
  expect(cancelNotice).not.toHaveBeenCalled();
  noticed.abort();
  expect(cancelNotice).toHaveBeenCalledOnce();
});

it('dismisses at once when the request signal aborted before it opened', () => {
  const ui = new LoggingUI();
  vi.spyOn(ui, 'requestQuestion').mockReturnValue(new Promise(() => undefined));
  const cancelAsk = vi.spyOn(ui, 'cancelPendingQuestion');
  vi.spyOn(ui, 'showTaskNotice').mockReturnValue(new Promise(() => undefined));
  const cancelNotice = vi.spyOn(ui, 'cancelTaskNotice');
  const interaction = uiInteraction(ui);
  // An abort listener added to an aborted signal never fires.
  void interaction.ask?.(question, { signal: AbortSignal.abort() });
  void interaction.taskNotice?.(notice, { signal: AbortSignal.abort() });
  expect(cancelAsk).toHaveBeenCalledOnce();
  expect(cancelNotice).toHaveBeenCalledOnce();
});

it('settles a timed-out question when the host dismissal throws', async () => {
  vi.useFakeTimers();
  try {
    const ui = new LoggingUI();
    vi.spyOn(ui, 'requestQuestion').mockReturnValue(
      new Promise(() => undefined),
    );
    const broken = new Error('overlay broken');
    vi.spyOn(ui, 'cancelPendingQuestion').mockImplementation(() => {
      throw broken;
    });
    const { ask } = uiInteraction(ui);
    if (!ask) throw new Error('uiInteraction answers questions');
    const bridge = createWizardAskBridge({
      getSource: () => 'test',
      showQuestion: ask,
      timeoutMs: 1000,
    });
    const result = bridge.request({
      questions: [{ id: 'goal', prompt: 'Goal?', kind: 'text' }],
    });
    vi.advanceTimersByTime(1000);
    await expect(result).resolves.toEqual({
      answers: { goal: CANCELLED_SENTINEL },
      timedOut: true,
    });
    expect(bridge.getPendingQuestion()).toBeNull();
    // Node rethrows an abort listener's error as an uncaught exception the
    // bridge cannot catch, so the answerer logs it instead.
    expect(logToFile).toHaveBeenCalledWith(expect.any(String), broken);
  } finally {
    vi.useRealTimers();
  }
});

it('logs a throwing notice dismissal instead of throwing from the abort', () => {
  const ui = new LoggingUI();
  vi.spyOn(ui, 'showTaskNotice').mockReturnValue(new Promise(() => undefined));
  const broken = new Error('overlay broken');
  vi.spyOn(ui, 'cancelTaskNotice').mockImplementation(() => {
    throw broken;
  });
  const noticed = new AbortController();
  void uiInteraction(ui).taskNotice?.(notice, { signal: noticed.signal });

  noticed.abort();
  expect(logToFile).toHaveBeenCalledWith(expect.any(String), broken);
});
