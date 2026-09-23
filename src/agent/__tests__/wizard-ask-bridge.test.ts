import {
  CANCELLED_SENTINEL,
  createWizardAskBridge,
  isFullyCancelled,
} from '@agent/wizard-ask-bridge';
import { analytics } from '@utils/analytics';
import type { AskAnswers, PendingQuestion } from '@lib/wizard-session';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
  },
}));

const wizardCaptureMock = analytics.wizardCapture as Mock;

beforeEach(() => {
  wizardCaptureMock.mockClear();
});

describe('createWizardAskBridge', () => {
  it('dismisses and settles an active question on run cancellation', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const bridge = createWizardAskBridge({
      signal: controller.signal,
      getSource: () => 'skill',
      showQuestion: (_question, { signal }) => {
        signals.push(signal);
        return new Promise<AskAnswers>(() => undefined);
      },
    });
    const result = bridge.request({
      questions: [{ id: 'goal', prompt: 'Goal?', kind: 'text' }],
    });
    expect(bridge.getPendingQuestion()).not.toBeNull();
    expect(signals[0].aborted).toBe(false);
    controller.abort();
    await expect(result).resolves.toEqual({
      answers: { goal: CANCELLED_SENTINEL },
      timedOut: false,
    });
    // The run's abort reaches the host as this question's own abort, so the
    // host dismisses the overlay it opened.
    expect(signals[0].aborted).toBe(true);
    expect(bridge.getPendingQuestion()).toBeNull();
  });

  it('aborts every open question when the run is cancelled', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const bridge = createWizardAskBridge({
      signal: controller.signal,
      getSource: () => 'skill',
      showQuestion: (_question, { signal }) => {
        signals.push(signal);
        return new Promise<AskAnswers>(() => undefined);
      },
    });
    const questions = [{ id: 'goal', prompt: 'Goal?', kind: 'text' as const }];
    const first = bridge.request({ questions });
    const second = bridge.request({ questions });
    controller.abort();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { answers: { goal: CANCELLED_SENTINEL }, timedOut: false },
      { answers: { goal: CANCELLED_SENTINEL }, timedOut: false },
    ]);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it('leaves an answered question alone when the run is cancelled later', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const bridge = createWizardAskBridge({
      signal: controller.signal,
      getSource: () => 'skill',
      showQuestion: (_question, { signal }) => {
        signals.push(signal);
        return Promise.resolve({ goal: 'ship it' });
      },
    });
    await expect(
      bridge.request({
        questions: [{ id: 'goal', prompt: 'Goal?', kind: 'text' }],
      }),
    ).resolves.toEqual({ answers: { goal: 'ship it' }, timedOut: false });
    controller.abort();
    // A late abort must not dismiss whatever the host shows next.
    expect(signals[0].aborted).toBe(false);
  });

  it('settles a cancelled question when the host rejects on dismissal', async () => {
    const controller = new AbortController();
    const bridge = createWizardAskBridge({
      signal: controller.signal,
      getSource: () => 'skill',
      showQuestion: (_question, { signal }) =>
        new Promise<AskAnswers>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('overlay broken')),
            { once: true },
          );
        }),
    });
    const result = bridge.request({
      questions: [{ id: 'goal', prompt: 'Goal?', kind: 'text' }],
    });
    controller.abort();
    await expect(result).resolves.toEqual({
      answers: { goal: CANCELLED_SENTINEL },
      timedOut: false,
    });
    expect(bridge.getPendingQuestion()).toBeNull();
  });

  it('does not open a question when the run was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const showQuestion = vi.fn();
    const bridge = createWizardAskBridge({
      signal: controller.signal,
      getSource: () => 'skill',
      showQuestion,
    });
    await expect(
      bridge.request({
        questions: [{ id: 'goal', prompt: 'Goal?', kind: 'text' }],
      }),
    ).resolves.toEqual({
      answers: { goal: CANCELLED_SENTINEL },
      timedOut: false,
    });
    expect(showQuestion).not.toHaveBeenCalled();
    expect(bridge.getPendingQuestion()).toBeNull();
  });

  it('forwards questions to showQuestion and resolves with the captured answers', async () => {
    const captured: PendingQuestion[] = [];
    let resolveAnswers!: (answers: AskAnswers) => void;
    const showQuestion = (q: PendingQuestion): Promise<AskAnswers> => {
      captured.push(q);
      return new Promise<AskAnswers>((r) => {
        resolveAnswers = r;
      });
    };

    const bridge = createWizardAskBridge({
      getSource: () => 'creating-product-tours',
      showQuestion,
    });

    const requestPromise = bridge.request({
      questions: [{ id: 'goal', prompt: 'Goal?', kind: 'text' }],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].questions).toEqual([
      { id: 'goal', prompt: 'Goal?', kind: 'text' },
    ]);
    expect(captured[0].source).toBe('creating-product-tours');
    expect(captured[0].id).toMatch(/.+/);

    resolveAnswers({ goal: 'Help users find the export button' });

    await expect(requestPromise).resolves.toEqual({
      answers: { goal: 'Help users find the export button' },
      timedOut: false,
    });
  });

  it('stamps a unique id per request', async () => {
    const ids: string[] = [];
    const showQuestion = (q: PendingQuestion): Promise<AskAnswers> => {
      ids.push(q.id);
      return Promise.resolve({});
    };

    const bridge = createWizardAskBridge({
      getSource: () => 'skill',
      showQuestion,
    });

    await bridge.request({
      questions: [{ id: 'a', prompt: 'A', kind: 'text' }],
    });
    await bridge.request({
      questions: [{ id: 'a', prompt: 'A', kind: 'text' }],
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('reads source from getSource at call time so late-bound skillIds work', async () => {
    let source = 'first-skill';
    const captured: PendingQuestion[] = [];
    const showQuestion = (q: PendingQuestion): Promise<AskAnswers> => {
      captured.push(q);
      return Promise.resolve({});
    };

    const bridge = createWizardAskBridge({
      getSource: () => source,
      showQuestion,
    });

    await bridge.request({
      questions: [{ id: 'a', prompt: 'A', kind: 'text' }],
    });
    source = 'second-skill';
    await bridge.request({
      questions: [{ id: 'b', prompt: 'B', kind: 'text' }],
    });

    expect(captured[0].source).toBe('first-skill');
    expect(captured[1].source).toBe('second-skill');
  });

  describe('analytics', () => {
    it('emits `wizard_ask answered` with duration and question count', async () => {
      let resolveAnswers!: (answers: AskAnswers) => void;
      const bridge = createWizardAskBridge({
        getSource: () => 'product-tours',
        showQuestion: () =>
          new Promise<AskAnswers>((r) => {
            resolveAnswers = r;
          }),
      });

      const p = bridge.request({
        questions: [
          { id: 'a', prompt: 'A', kind: 'text' },
          { id: 'b', prompt: 'B', kind: 'text' },
        ],
        subject: 'postgres',
      });
      resolveAnswers({ a: 'x', b: 'y' });
      await p;

      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'wizard_ask answered',
        expect.objectContaining({
          source: 'product-tours',
          subject: 'postgres',
          question_count: 2,
          duration_ms: expect.any(Number),
        }),
      );
    });

    it('emits `wizard_ask cancelled` when every field comes back as the cancelled sentinel', async () => {
      const bridge = createWizardAskBridge({
        getSource: () => 'product-tours',
        showQuestion: () =>
          Promise.resolve({ a: CANCELLED_SENTINEL, b: CANCELLED_SENTINEL }),
      });

      await bridge.request({
        questions: [
          { id: 'a', prompt: 'A', kind: 'text' },
          { id: 'b', prompt: 'B', kind: 'text' },
        ],
        subject: 'stripe',
      });

      const cancelledCall = wizardCaptureMock.mock.calls.find(
        ([name]) => name === 'wizard_ask cancelled',
      );
      expect(cancelledCall).toBeDefined();
      expect(cancelledCall?.[1]).toMatchObject({
        source: 'product-tours',
        subject: 'stripe',
        question_count: 2,
        timed_out: false,
      });

      // It is cancelled, not answered.
      expect(
        wizardCaptureMock.mock.calls.some(
          ([name]) => name === 'wizard_ask answered',
        ),
      ).toBe(false);
    });
  });

  it('reports a user-dismissed ask as cancelled but not timed out', async () => {
    // The two arrive identically in `answers`, so `timedOut` is the only thing
    // that tells the tool facades a decline from an unattended terminal.
    const bridge = createWizardAskBridge({
      getSource: () => 'product-tours',
      showQuestion: () => Promise.resolve({ host: CANCELLED_SENTINEL }),
      timeoutMs: 60_000,
    });

    await expect(
      bridge.request({
        questions: [{ id: 'host', prompt: 'Host?', kind: 'text' }],
      }),
    ).resolves.toEqual({
      answers: { host: CANCELLED_SENTINEL },
      timedOut: false,
    });
  });

  describe('isFullyCancelled', () => {
    // Gates the per-run cap refund in wizard-tools: a fully cancelled ask must
    // not burn a wizard_ask slot, while any real answer must still count.
    it('is true only when every field is the cancelled sentinel', () => {
      expect(
        isFullyCancelled({ a: CANCELLED_SENTINEL, b: CANCELLED_SENTINEL }),
      ).toBe(true);
    });

    it('is false when at least one field has a real answer', () => {
      expect(isFullyCancelled({ a: CANCELLED_SENTINEL, b: 'real' })).toBe(
        false,
      );
    });

    it('is false when nothing was cancelled', () => {
      expect(isFullyCancelled({ a: 'x', b: ['y', 'z'] })).toBe(false);
    });

    it('is false for an empty answer map', () => {
      expect(isFullyCancelled({})).toBe(false);
    });
  });

  describe('timeout', () => {
    it('resolves every field with the cancelled sentinel and aborts the question when the user does not answer in time', async () => {
      vi.useFakeTimers();
      try {
        // showQuestion intentionally never resolves — the timeout has to win.
        const signals: AbortSignal[] = [];
        const bridge = createWizardAskBridge({
          getSource: () => 'product-tours',
          showQuestion: (_question, { signal }) => {
            signals.push(signal);
            return new Promise<AskAnswers>(() => undefined);
          },
          timeoutMs: 1000,
        });

        const promise = bridge.request({
          questions: [
            { id: 'goal', prompt: 'Goal?', kind: 'text' },
            { id: 'audience', prompt: 'Who?', kind: 'text' },
          ],
        });
        expect(signals[0].aborted).toBe(false);

        vi.advanceTimersByTime(1000);

        await expect(promise).resolves.toEqual({
          answers: {
            goal: CANCELLED_SENTINEL,
            audience: CANCELLED_SENTINEL,
          },
          timedOut: true,
        });

        // Without this, the host's pending-question state survives the
        // timeout and every later wizard_ask in the run is rejected as a
        // duplicate request.
        expect(signals[0].aborted).toBe(true);

        const cancelledCall = wizardCaptureMock.mock.calls.find(
          ([name]) => name === 'wizard_ask cancelled',
        );
        expect(cancelledCall?.[1]).toMatchObject({ timed_out: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('settles a timed-out question when the host rejects on dismissal', async () => {
      vi.useFakeTimers();
      try {
        // The host's dismissal is its own: an abort listener's throw reaches
        // no caller. What reaches the bridge is the host's promise, which may
        // reject once its overlay is torn down; the timeout has already won.
        const bridge = createWizardAskBridge({
          getSource: () => 'product-tours',
          showQuestion: (_question, { signal }) =>
            new Promise<AskAnswers>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new Error('overlay broken')),
                { once: true },
              );
            }),
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
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not abort the question when the user answers before the timeout', async () => {
      vi.useFakeTimers();
      try {
        const signals: AbortSignal[] = [];
        const bridge = createWizardAskBridge({
          getSource: () => 'product-tours',
          showQuestion: (_question, { signal }) => {
            signals.push(signal);
            return Promise.resolve({ goal: 'ship it' });
          },
          timeoutMs: 1000,
        });

        await bridge.request({
          questions: [{ id: 'goal', prompt: 'Goal?', kind: 'text' }],
        });

        vi.advanceTimersByTime(1000);
        expect(signals[0].aborted).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('aborts only the question whose timeout fired', async () => {
      vi.useFakeTimers();
      try {
        const signals: AbortSignal[] = [];
        const bridge = createWizardAskBridge({
          getSource: () => 'product-tours',
          showQuestion: (_question, { signal }) => {
            signals.push(signal);
            return new Promise<AskAnswers>(() => undefined);
          },
          timeoutMs: 1000,
        });
        const questions = [
          { id: 'goal', prompt: 'Goal?', kind: 'text' as const },
        ];

        const first = bridge.request({ questions });
        vi.advanceTimersByTime(500);
        void bridge.request({ questions });
        vi.advanceTimersByTime(500);

        await expect(first).resolves.toMatchObject({ timedOut: true });
        // The second question is still open: the first one's timeout must not
        // dismiss it.
        expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
