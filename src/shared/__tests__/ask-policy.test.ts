import { shouldDisableAsk } from '@shared/ask-policy';

describe('shouldDisableAsk', () => {
  // The full truth table over the three inputs. `e2eAsk` is the harness escape
  // hatch: it re-enables the bridge in an otherwise non-interactive run,
  // because the e2e driver loop answers each batch from the program's profile.
  it.each([
    { ci: false, signup: false, e2eAsk: false, disabled: false },
    { ci: false, signup: false, e2eAsk: true, disabled: false },
    { ci: true, signup: false, e2eAsk: false, disabled: true },
    { ci: true, signup: false, e2eAsk: true, disabled: false },
    { ci: false, signup: true, e2eAsk: false, disabled: true },
    { ci: false, signup: true, e2eAsk: true, disabled: false },
    { ci: true, signup: true, e2eAsk: false, disabled: true },
    { ci: true, signup: true, e2eAsk: true, disabled: false },
  ])(
    'ci=$ci signup=$signup e2eAsk=$e2eAsk → disabled=$disabled',
    ({ ci, signup, e2eAsk, disabled }) => {
      expect(shouldDisableAsk({ ci, signup, e2eAsk })).toBe(disabled);
    },
  );
});
