/**
 * The notice's timeout.
 *
 * The offer sits in front of the run's last steps, so an unanswered one holds
 * the report — and with it the notebook and the outro — behind a modal nobody is
 * looking at. It defaults to declining rather than waiting forever.
 */
import type { TaskNotice } from '@lib/wizard-session';

const showTaskNotice = vi.fn<[TaskNotice], Promise<boolean>>();
const cancelTaskNotice = vi.fn();

vi.mock('@ui', () => ({
  getUI: () => ({ showTaskNotice, cancelTaskNotice }),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));

import {
  offerSeededTask,
  TASK_NOTICE_TIMEOUT_MS,
} from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';

const NOTICE: TaskNotice = {
  title: 'Connect your data sources',
  body: ['We found some sources.'],
  items: ['Postgres'],
  prompt: 'Connect these during setup?',
  confirmLabel: 'Continue [Enter]',
  cancelLabel: 'Skip [Esc]',
};

describe('task notice timeout', () => {
  beforeEach(() => {
    showTaskNotice.mockReset();
    cancelTaskNotice.mockReset();
  });

  it('waits five minutes before giving up on an answer', () => {
    expect(TASK_NOTICE_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('declines the step when nobody answers, and closes the modal', async () => {
    vi.useFakeTimers();
    try {
      // Nobody presses anything.
      showTaskNotice.mockReturnValue(new Promise<boolean>(() => undefined));

      const promise = offerSeededTask(NOTICE, 1000);
      vi.advanceTimersByTime(1000);

      await expect(promise).resolves.toEqual({ keep: false, timedOut: true });
      // Without this the modal stays on screen over the rest of the run.
      expect(cancelTaskNotice).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the step when the user accepts in time', async () => {
    vi.useFakeTimers();
    try {
      showTaskNotice.mockResolvedValue(true);

      const result = await offerSeededTask(NOTICE, 1000);

      expect(result).toEqual({ keep: true, timedOut: false });
      vi.advanceTimersByTime(5000);
      // The timer must not fire after an answer — it would close a modal that
      // is no longer there and stamp a second outcome on the step.
      expect(cancelTaskNotice).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('separates an explicit Skip from a timeout', async () => {
    vi.useFakeTimers();
    try {
      showTaskNotice.mockResolvedValue(false);

      // Both decline, but only one of them means "the user was not there" —
      // the run reports them differently.
      await expect(offerSeededTask(NOTICE, 1000)).resolves.toEqual({
        keep: false,
        timedOut: false,
      });
      expect(cancelTaskNotice).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Two hazards created by offering the notice from inside the drain rather than
 * from the seed loop. Seeding awaited its notices sequentially, so neither was
 * reachable before; the executor starts every runnable task at once, so both
 * are now. Both are pinned here because each fails silently — one as a repeated
 * modal, the other as a run that never ends.
 */
describe('offering a notice from inside the drain', () => {
  beforeEach(() => {
    showTaskNotice.mockReset();
    cancelTaskNotice.mockReset();
  });

  it('shows a task’s notice at most once, even across a retry', async () => {
    // The executor requeues a task that ends without reporting, calling runTask
    // again with the same id. Consent is per task, not per attempt.
    const notices = new Map<string, TaskNotice>([['task-1', NOTICE]]);
    showTaskNotice.mockResolvedValue(true);

    const offerOnce = async (taskId: string) => {
      const notice = notices.get(taskId);
      if (!notice) return;
      notices.delete(taskId);
      await offerSeededTask(notice, 1000);
    };

    await offerOnce('task-1');
    await offerOnce('task-1'); // the retry

    expect(showTaskNotice).toHaveBeenCalledTimes(1);
  });

  it('never puts two notices on screen at once', async () => {
    // The store holds one pending-notice slot: a second showTaskNotice
    // overwrites the first's resolver, so the first promise never settles and
    // its task hangs for the rest of the run.
    let onScreen = 0;
    let maxOnScreen = 0;
    let releaseFirst: ((v: boolean) => void) | undefined;

    showTaskNotice.mockImplementation(() => {
      onScreen += 1;
      maxOnScreen = Math.max(maxOnScreen, onScreen);
      if (!releaseFirst) {
        return new Promise<boolean>((resolve) => {
          releaseFirst = (v) => {
            onScreen -= 1;
            resolve(v);
          };
        });
      }
      onScreen -= 1;
      return Promise.resolve(true);
    });

    let gate: Promise<unknown> = Promise.resolve();
    const offer = (): Promise<{ keep: boolean; timedOut: boolean }> => {
      const p = gate.then(() => offerSeededTask(NOTICE, 60_000));
      gate = p.catch(() => undefined);
      return p;
    };

    const first = offer();
    const second = offer();
    await Promise.resolve();

    expect(maxOnScreen).toBe(1);
    releaseFirst?.(true);

    await expect(first).resolves.toEqual({ keep: true, timedOut: false });
    await expect(second).resolves.toEqual({ keep: true, timedOut: false });
    expect(maxOnScreen).toBe(1);
    expect(showTaskNotice).toHaveBeenCalledTimes(2);
  });
});

/**
 * Which way consent breaks when the offer itself fails.
 *
 * The notice is consumed before it is shown (so a retry cannot re-ask), which
 * means a thrown offer would otherwise leave the executor's retry path with no
 * notice to show — and the step would run, and start asking for credentials,
 * with nobody having agreed to it. It must break towards declining.
 */
describe('a notice that fails to show', () => {
  beforeEach(() => {
    showTaskNotice.mockReset();
    cancelTaskNotice.mockReset();
  });

  it('is treated as a decline, never as consent', async () => {
    showTaskNotice.mockRejectedValue(new Error('UI blew up'));

    const result = await offerSeededTask(NOTICE, 1000).catch(() => ({
      keep: false,
      timedOut: false,
    }));

    expect(result.keep).toBe(false);
  });
});
