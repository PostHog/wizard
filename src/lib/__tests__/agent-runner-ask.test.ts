import { shouldDisableAsk } from '@lib/agent/agent-runner';

describe('shouldDisableAsk', () => {
  it('enables wizard_ask in interactive runs by default', () => {
    expect(shouldDisableAsk({ ci: false, signup: false })).toBe(false);
  });

  it('auto-disables when running in CI mode', () => {
    expect(shouldDisableAsk({ ci: true, signup: false })).toBe(true);
  });

  it('auto-disables during the signup flow (which is non-interactive at the prompt layer)', () => {
    expect(shouldDisableAsk({ ci: false, signup: true })).toBe(true);
  });
});
