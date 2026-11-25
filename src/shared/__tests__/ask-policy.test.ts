import { shouldDisableAsk } from '@shared/ask-policy';

describe('shouldDisableAsk', () => {
  // The full truth table over the two inputs. `e2eAsk` is the harness escape
  // hatch: it re-enables the bridge in an otherwise non-interactive run,
  // because the e2e driver loop answers each batch from the program's profile.
  it.each([
    { ci: false, e2eAsk: false, disabled: false },
    { ci: false, e2eAsk: true, disabled: false },
    { ci: true, e2eAsk: false, disabled: true },
    { ci: true, e2eAsk: true, disabled: false },
  ])(
    'ci=$ci e2eAsk=$e2eAsk → disabled=$disabled',
    ({ ci, e2eAsk, disabled }) => {
      expect(shouldDisableAsk({ ci, e2eAsk })).toBe(disabled);
    },
  );
});
