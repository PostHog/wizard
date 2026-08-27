/**
 * The notice's timeout, and where the notice is asked.
 *
 * The offer defaults to declining rather than waiting forever: a modal nobody
 * answers would otherwise hold the run behind a screen nobody is looking at.
 * That default is only safe where the user actually is, which is seconds into
 * the run — so the offer is made at seed time, and only the work it gates is
 * deferred to the end of the queue.
 */
import type { TaskNotice } from '@lib/wizard-session';

// Hoisted: `vi.mock` factories are lifted above the imports, so the analytics
// factory would otherwise read these before they exist.
const { showTaskNotice, cancelTaskNotice, wizardCapture, captureException } =
  vi.hoisted(() => ({
    showTaskNotice: vi.fn<[TaskNotice], Promise<boolean>>(),
    cancelTaskNotice: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
  }));

vi.mock('@ui', () => ({
  getUI: () => ({ showTaskNotice, cancelTaskNotice }),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture,
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException,
  },
}));

import {
  askSeededConsent,
  consentSkipReason,
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

const resetMocks = () => {
  showTaskNotice.mockReset();
  cancelTaskNotice.mockReset();
  wizardCapture.mockReset();
  captureException.mockReset();
};

describe('task notice timeout', () => {
  beforeEach(resetMocks);

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
      // the run reports them differently, and now skips them differently too.
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
 * Every way of not saying yes maps to its own skip reason.
 *
 * The three are different facts about the user: one said no, one was not there,
 * and one was never asked. Collapsing them is what made a week of auto-declines
 * look like ordinary skipped steps.
 */
describe('consentSkipReason', () => {
  it.each([
    [
      'an explicit Skip',
      { keep: false, timedOut: false, errored: false },
      'user-declined',
    ],
    [
      'an unanswered offer',
      { keep: false, timedOut: true, errored: false },
      'notice-timeout',
    ],
    [
      'an offer that could not be shown',
      { keep: false, timedOut: false, errored: true },
      'notice-error',
    ],
  ])('maps %s to %s', (_label, consent, expected) => {
    expect(consentSkipReason(consent)).toBe(expected);
  });

  it('reports a failed notice as an error, not as a timeout', () => {
    // Both are "the user did not decline", and only one of them is worth
    // paging someone about.
    expect(
      consentSkipReason({ keep: false, timedOut: true, errored: true }),
    ).toBe('notice-error');
  });
});

/**
 * Asking for consent at seed time.
 *
 * #1103 moved this ask to the moment the task became runnable — a median seven
 * minutes into the run, after every coding task, with the user long since gone.
 * The five-minute default then answered for them. Consent belongs where the
 * user still is; only the work it gates belongs at the end.
 */
describe('askSeededConsent', () => {
  beforeEach(resetMocks);

  it('records an acceptance', async () => {
    showTaskNotice.mockResolvedValue(true);

    await expect(askSeededConsent('warehouse', NOTICE, 1000)).resolves.toEqual({
      keep: true,
      timedOut: false,
      errored: false,
    });
  });

  it('records an explicit decline', async () => {
    showTaskNotice.mockResolvedValue(false);

    await expect(askSeededConsent('warehouse', NOTICE, 1000)).resolves.toEqual({
      keep: false,
      timedOut: false,
      errored: false,
    });
  });

  it('records a timeout as a decline the user never gave', async () => {
    vi.useFakeTimers();
    try {
      showTaskNotice.mockReturnValue(new Promise<boolean>(() => undefined));

      const promise = askSeededConsent('warehouse', NOTICE, 1000);
      vi.advanceTimersByTime(1000);

      await expect(promise).resolves.toEqual({
        keep: false,
        timedOut: true,
        errored: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the answer on one event per offer', async () => {
    showTaskNotice.mockResolvedValue(true);

    await askSeededConsent('warehouse', NOTICE, 1000);

    expect(wizardCapture).toHaveBeenCalledTimes(1);
    expect(wizardCapture).toHaveBeenCalledWith(
      'orchestrator task notice answered',
      { type: 'warehouse', kept: true, timed_out: false, errored: false },
    );
  });

  it('is treated as a decline when the notice throws, never as consent', async () => {
    // The step this gates goes on to ask for live credentials, so a question
    // that could not be put to the user must never be read as a yes.
    showTaskNotice.mockRejectedValue(new Error('UI blew up'));

    await expect(askSeededConsent('warehouse', NOTICE, 1000)).resolves.toEqual({
      keep: false,
      timedOut: false,
      errored: true,
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(wizardCapture).toHaveBeenCalledWith(
      'orchestrator task notice answered',
      { type: 'warehouse', kept: false, timed_out: false, errored: true },
    );
  });
});

/**
 * Two hazards that come from *where* the offer is made.
 *
 * #1103 offered notices from inside the drain, which starts every runnable task
 * at once; that made a second modal and a re-offer on retry reachable for the
 * first time, and each fails silently — one as a repeated modal, the other as a
 * run that never ends. Asking from the seed loop instead removes both by
 * construction, and these pin that the seed loop keeps the properties the
 * in-drain gate had to build by hand.
 */
describe('offering notices from the seed loop', () => {
  beforeEach(resetMocks);

  /** The seed loop: one entry at a time, each awaited before the next. */
  const seedLoop = async (entries: readonly { type: string }[]) => {
    const answers: { keep: boolean; timedOut: boolean; errored: boolean }[] =
      [];
    for (const entry of entries) {
      answers.push(await askSeededConsent(entry.type, NOTICE, 60_000));
    }
    return answers;
  };

  it('never puts two notices on screen at once', async () => {
    // The store holds one pending-notice slot: a second showTaskNotice
    // overwrites the first's resolver, so the first promise never settles and
    // its task hangs for the rest of the run.
    let onScreen = 0;
    let maxOnScreen = 0;

    showTaskNotice.mockImplementation(async () => {
      onScreen += 1;
      maxOnScreen = Math.max(maxOnScreen, onScreen);
      await Promise.resolve();
      onScreen -= 1;
      return true;
    });

    const answers = await seedLoop([{ type: 'warehouse' }, { type: 'other' }]);

    expect(maxOnScreen).toBe(1);
    expect(answers).toEqual([
      { keep: true, timedOut: false, errored: false },
      { keep: true, timedOut: false, errored: false },
    ]);
    expect(showTaskNotice).toHaveBeenCalledTimes(2);
  });

  it('shows a task’s notice at most once, whatever the drain does later', async () => {
    // The executor requeues a task that ends without reporting, calling runTask
    // again with the same id. The offer is no longer in runTask at all, so a
    // retry cannot re-ask — consent is per task, not per attempt, and it was
    // taken before the drain started.
    showTaskNotice.mockResolvedValue(true);

    const consent = new Map(
      (await seedLoop([{ type: 'warehouse' }])).map((answer) => [
        'task-1',
        answer,
      ]),
    );
    const runTask = (taskId: string) => consent.get(taskId)?.keep === true;

    expect(runTask('task-1')).toBe(true);
    expect(runTask('task-1')).toBe(true); // the retry
    expect(showTaskNotice).toHaveBeenCalledTimes(1);
  });
});
