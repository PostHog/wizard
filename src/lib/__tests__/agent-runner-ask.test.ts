import { shouldDisableAsk } from '../agent/agent-runner';

const baseSession = { ci: false, signup: false };
const baseConfig = {};

describe('shouldDisableAsk', () => {
  it('enables wizard_ask in interactive runs by default', () => {
    expect(shouldDisableAsk(baseSession, baseConfig)).toBe(false);
  });

  it('auto-disables when running in CI mode', () => {
    expect(shouldDisableAsk({ ci: true, signup: false }, baseConfig)).toBe(
      true,
    );
  });

  it('auto-disables during the signup flow (which is non-interactive at the prompt layer)', () => {
    expect(shouldDisableAsk({ ci: false, signup: true }, baseConfig)).toBe(
      true,
    );
  });

  it('honors an explicit disableAsk override on the workflow', () => {
    expect(shouldDisableAsk(baseSession, { disableAsk: true })).toBe(true);
  });

  it('treats disableAsk=false as not disabling', () => {
    expect(shouldDisableAsk(baseSession, { disableAsk: false })).toBe(false);
  });
});
