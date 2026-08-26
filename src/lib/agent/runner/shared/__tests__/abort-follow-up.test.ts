import { collectAbortFollowUp } from '@lib/agent/runner/shared/abort-follow-up';
import type { AbortCase } from '@lib/agent/runner/shared/types';
import {
  CANCELLED_SENTINEL,
  type WizardAskBridge,
} from '@lib/wizard-ask-bridge';
import type { AskAnswers, AskQuestion } from '@lib/wizard-session';

const PICKER: AskQuestion = {
  id: 'mcp_server_kind',
  kind: 'single',
  prompt: 'What is in this project?',
  options: [{ label: 'Python', value: 'python' }],
};

function bridge(answers: AskAnswers | Error): WizardAskBridge {
  return {
    request: () =>
      answers instanceof Error
        ? Promise.reject(answers)
        : Promise.resolve(answers),
  };
}

function abortCase(followUp?: AskQuestion[]): AbortCase {
  return { match: /x/, message: 'm', body: 'b', followUp };
}

describe('collectAbortFollowUp', () => {
  it('ships a picked value under a follow_up_ key', async () => {
    await expect(
      collectAbortFollowUp(
        abortCase([PICKER]),
        bridge({ mcp_server_kind: 'python' }),
      ),
    ).resolves.toEqual({ follow_up_mcp_server_kind: 'python' });
  });

  // Every branch below must exit as if no question were configured — asking is
  // a bonus, and an abort that hangs or throws on it is worse than no data.
  it('asks nothing when the case declares no follow-up', async () => {
    const ask = bridge({ mcp_server_kind: 'python' });
    const spy = vi.spyOn(ask, 'request');
    await expect(collectAbortFollowUp(abortCase(), ask)).resolves.toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('asks nothing when there is no bridge (CI, signup)', async () => {
    await expect(
      collectAbortFollowUp(abortCase([PICKER]), undefined),
    ).resolves.toEqual({});
  });

  it('asks nothing when the abort matched no known case', async () => {
    await expect(
      collectAbortFollowUp(undefined, bridge({ a: 'b' })),
    ).resolves.toEqual({});
  });

  it('swallows a failing request', async () => {
    await expect(
      collectAbortFollowUp(abortCase([PICKER]), bridge(new Error('overlay'))),
    ).resolves.toEqual({});
  });

  it('drops a cancelled or timed-out answer', async () => {
    await expect(
      collectAbortFollowUp(
        abortCase([PICKER]),
        bridge({ mcp_server_kind: CANCELLED_SENTINEL }),
      ),
    ).resolves.toEqual({});
  });

  it('records that a free-text question was answered, never what was typed', async () => {
    // Free text is a path, a repo name, an internal service — none of which
    // belongs on an analytics event.
    const text: AskQuestion = {
      id: 'where',
      kind: 'text',
      prompt: 'Where is it?',
    };
    await expect(
      collectAbortFollowUp(
        abortCase([text, PICKER]),
        bridge({ where: '/srv/internal/acme-mcp', mcp_server_kind: 'python' }),
      ),
    ).resolves.toEqual({
      follow_up_where: true,
      follow_up_mcp_server_kind: 'python',
    });
  });

  it('keeps multi-select answers as arrays', async () => {
    const multi: AskQuestion = {
      id: 'langs',
      kind: 'multi',
      prompt: 'Which?',
      options: [{ label: 'Go', value: 'go' }],
    };
    await expect(
      collectAbortFollowUp(abortCase([multi]), bridge({ langs: ['go', 'rb'] })),
    ).resolves.toEqual({ follow_up_langs: ['go', 'rb'] });
  });
});
