vi.mock(import('@utils/debug'));
vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn() } as never,
}));

import { logToFile } from '@utils/debug';
import { storeInteraction } from '../interaction';
import { SessionStore } from '../session-store';
import { buildSession } from '../wizard-session';

beforeEach(() => {
  vi.mocked(logToFile).mockClear();
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
  const store = new SessionStore(buildSession({ installDir: '/project' }));
  const ask = vi
    .spyOn(store, 'requestQuestion')
    .mockResolvedValue({ q: 'yes' });
  const cancelAsk = vi.spyOn(store, 'cancelPendingQuestion');
  const show = vi.spyOn(store, 'showTaskNotice').mockResolvedValue(true);
  const cancelNotice = vi.spyOn(store, 'resolveTaskNotice');
  const interaction = storeInteraction(store);
  const asked = new AbortController();
  const noticed = new AbortController();
  const onAnswer = vi.fn();
  await expect(
    interaction.ask?.(question, { signal: asked.signal, onAnswer }),
  ).resolves.toEqual({ q: 'yes' });
  await expect(
    interaction.taskNotice?.(notice, { signal: noticed.signal }),
  ).resolves.toBe(true);
  // A late abort must not dismiss whatever the host shows next.
  asked.abort();
  noticed.abort();
  // The store gets the bridge's timeout heartbeat alongside the question.
  expect(ask).toHaveBeenCalledWith(question, onAnswer);
  expect(show).toHaveBeenCalledWith(notice);
  expect(cancelAsk).not.toHaveBeenCalled();
  expect(cancelNotice).not.toHaveBeenCalled();
});

it('dismisses an open question or notice when its signal aborts', () => {
  const store = new SessionStore(buildSession({ installDir: '/project' }));
  vi.spyOn(store, 'requestQuestion').mockReturnValue(
    new Promise(() => undefined),
  );
  const cancelAsk = vi.spyOn(store, 'cancelPendingQuestion');
  vi.spyOn(store, 'showTaskNotice').mockReturnValue(
    new Promise(() => undefined),
  );
  const cancelNotice = vi.spyOn(store, 'resolveTaskNotice');
  const interaction = storeInteraction(store);
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
  const store = new SessionStore(buildSession({ installDir: '/project' }));
  vi.spyOn(store, 'requestQuestion').mockReturnValue(
    new Promise(() => undefined),
  );
  const cancelAsk = vi.spyOn(store, 'cancelPendingQuestion');
  vi.spyOn(store, 'showTaskNotice').mockReturnValue(
    new Promise(() => undefined),
  );
  const cancelNotice = vi.spyOn(store, 'resolveTaskNotice');
  const interaction = storeInteraction(store);
  // An abort listener added to an aborted signal never fires.
  void interaction.ask?.(question, { signal: AbortSignal.abort() });
  void interaction.taskNotice?.(notice, { signal: AbortSignal.abort() });
  expect(cancelAsk).toHaveBeenCalledOnce();
  expect(cancelNotice).toHaveBeenCalledOnce();
});

// The ask bridge aborts the signal on its timeout and settles on its own
// (wizard-ask-bridge.test.ts); the answerer's part is to not throw from the abort.
it('logs a throwing question dismissal instead of throwing from the abort', () => {
  const store = new SessionStore(buildSession({ installDir: '/project' }));
  vi.spyOn(store, 'requestQuestion').mockReturnValue(
    new Promise(() => undefined),
  );
  const broken = new Error('overlay broken');
  vi.spyOn(store, 'cancelPendingQuestion').mockImplementation(() => {
    throw broken;
  });
  const asked = new AbortController();
  void storeInteraction(store).ask?.(question, { signal: asked.signal });

  // Node rethrows an abort listener's error as an uncaught exception the
  // bridge cannot catch, so the answerer logs it instead.
  asked.abort();
  expect(logToFile).toHaveBeenCalledWith(expect.any(String), broken);
});

it('logs a throwing notice dismissal instead of throwing from the abort', () => {
  const store = new SessionStore(buildSession({ installDir: '/project' }));
  vi.spyOn(store, 'showTaskNotice').mockReturnValue(
    new Promise(() => undefined),
  );
  const broken = new Error('overlay broken');
  vi.spyOn(store, 'resolveTaskNotice').mockImplementation(() => {
    throw broken;
  });
  const noticed = new AbortController();
  void storeInteraction(store).taskNotice?.(notice, { signal: noticed.signal });

  noticed.abort();
  expect(logToFile).toHaveBeenCalledWith(expect.any(String), broken);
});
