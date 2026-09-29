/**
 * The ask gate on a built session: `buildSession` defaults the harness-only
 * `e2eAsk` off, and the `POSTHOG_WIZARD_*` bag the CI runner spreads into it
 * cannot turn it back on.
 */
import { shouldDisableAsk } from '@shared/ask-policy';
import { readEnvironment } from '@utils/environment';
import { buildSession } from '../wizard-session';

describe('the ask gate on a built session', () => {
  afterEach(() => {
    delete process.env.POSTHOG_WIZARD_e2e_ask;
  });

  it('leaves a plain --ci session disabled — buildSession defaults e2eAsk to false', () => {
    const session = buildSession({
      installDir: '/tmp/ask-policy',
      ci: true,
    });
    expect(session.e2eAsk).toBe(false);
    expect(shouldDisableAsk(session)).toBe(true);
  });

  it('re-enables the bridge when the harness asks for it', () => {
    const session = buildSession({
      installDir: '/tmp/ask-policy',
      ci: true,
      e2eAsk: true,
    });
    expect(shouldDisableAsk(session)).toBe(false);
  });

  // The composition the CI runner performs: bag spread into buildSession.
  // Without the guard this flips the gate and the agent starts asking
  // questions into a run that cannot answer them.
  it('cannot re-enable wizard_ask in a --ci run', () => {
    process.env.POSTHOG_WIZARD_e2e_ask = 'true';
    const session = buildSession({
      installDir: '/tmp/env-bag',
      ci: true,
      ...readEnvironment(),
    });
    expect(session.e2eAsk).toBe(false);
    expect(shouldDisableAsk(session)).toBe(true);
  });
});
