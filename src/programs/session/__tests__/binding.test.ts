import { GPT5_6_SOL_MODEL, Harness, Sequence } from '@shared/constants';
import { SessionStore, applyAgentProgress } from '../session-store';
import { buildSession } from '../wizard-session';

describe('applyAgentProgress: binding', () => {
  it('records the binding the agent run resolved', () => {
    const store = new SessionStore(buildSession({}));
    const binding = {
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_6_SOL_MODEL,
      thinkingLevel: 'medium' as const,
    };
    applyAgentProgress(store, { kind: 'binding', binding });
    expect(store.session.binding).toEqual(binding);
  });
});
