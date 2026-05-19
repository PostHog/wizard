import { createWizardAskBridge } from '../wizard-ask-bridge';
import type { AskAnswers, PendingQuestion } from '../wizard-session';

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
});
