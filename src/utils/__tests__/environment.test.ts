/**
 * The `POSTHOG_WIZARD_*` env bag.
 *
 * `read-env` camel-cases every prefixed variable into a session arg, and the CI
 * runner spreads the whole bag into `buildSession`. That makes the bag a second
 * way to set any session field — intended for `debug`, and not intended at all
 * for the harness-only `e2eAsk`, which would re-wire the `wizard_ask` bridge in
 * a run with nobody to answer.
 */

import { readEnvironment } from '@utils/environment';
import { buildSession } from '@lib/wizard-session';
import { shouldDisableAsk } from '@lib/agent/agent-runner';

/** Every var this file sets, cleared between cases. */
const TOUCHED = [
  'POSTHOG_WIZARD_DEBUG',
  'POSTHOG_WIZARD_E2E_ASK',
  'POSTHOG_WIZARD_e2e_ask',
  'POSTHOG_WIZARD_E2e_Ask',
  'POSTHOG_WIZARD_e2eAsk',
];

describe('readEnvironment', () => {
  afterEach(() => {
    for (const key of TOUCHED) delete process.env[key];
  });

  it('maps a prefixed variable onto its session arg', () => {
    process.env.POSTHOG_WIZARD_DEBUG = 'true';
    expect(readEnvironment()).toEqual({ debug: true });
  });

  // read-env's camel-casing is the reason this needs a list rather than one
  // exact-match check: POSTHOG_WIZARD_E2E_ASK yields `e2EAsk`, but the
  // lower/mixed-case spellings land exactly on the session's `e2eAsk`.
  it.each([
    'POSTHOG_WIZARD_E2E_ASK',
    'POSTHOG_WIZARD_e2e_ask',
    'POSTHOG_WIZARD_E2e_Ask',
    'POSTHOG_WIZARD_e2eAsk',
  ])('drops the harness-only ask flag set as %s', (name) => {
    process.env[name] = 'true';
    expect(Object.keys(readEnvironment())).toEqual([]);
  });

  it('drops only the harness flag, leaving the rest of the bag intact', () => {
    process.env.POSTHOG_WIZARD_DEBUG = 'true';
    process.env.POSTHOG_WIZARD_e2e_ask = 'true';
    expect(readEnvironment()).toEqual({ debug: true });
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
