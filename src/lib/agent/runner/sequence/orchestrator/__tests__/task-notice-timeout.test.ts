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
