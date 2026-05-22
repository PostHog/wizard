import {
  CANCELLED_SENTINEL,
  createWizardAskBridge,
} from '../wizard-ask-bridge';
import { analytics } from '../../utils/analytics';
import type { AskAnswers, PendingQuestion } from '../wizard-session';

jest.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: jest.fn(),
  },
}));

const wizardCaptureMock = analytics.wizardCapture as jest.Mock;

beforeEach(() => {
  wizardCaptureMock.mockClear();
});

describe('createWizardAskBridge', () => {
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
      goal: 'Help users find the export button',
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
      });
      resolveAnswers({ a: 'x', b: 'y' });
      await p;

      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'wizard_ask answered',
        expect.objectContaining({
          source: 'product-tours',
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
      });

      const cancelledCall = wizardCaptureMock.mock.calls.find(
        ([name]) => name === 'wizard_ask cancelled',
      );
      expect(cancelledCall).toBeDefined();
      expect(cancelledCall?.[1]).toMatchObject({
        source: 'product-tours',
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

  describe('timeout', () => {
    it('resolves every field with the cancelled sentinel when the user does not answer in time', async () => {
      jest.useFakeTimers();
      try {
        // showQuestion intentionally never resolves — the timeout has to win.
        const bridge = createWizardAskBridge({
          getSource: () => 'product-tours',
          showQuestion: () => new Promise<AskAnswers>(() => undefined),
          timeoutMs: 1000,
        });

        const promise = bridge.request({
          questions: [
            { id: 'goal', prompt: 'Goal?', kind: 'text' },
            { id: 'audience', prompt: 'Who?', kind: 'text' },
          ],
        });

        jest.advanceTimersByTime(1000);

        await expect(promise).resolves.toEqual({
          goal: CANCELLED_SENTINEL,
          audience: CANCELLED_SENTINEL,
        });

        const cancelledCall = wizardCaptureMock.mock.calls.find(
          ([name]) => name === 'wizard_ask cancelled',
        );
        expect(cancelledCall?.[1]).toMatchObject({ timed_out: true });
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
