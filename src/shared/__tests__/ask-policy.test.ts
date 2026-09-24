import { isAskDisabled } from '@shared/ask-policy';
import { buildSession } from '@tui/session';

describe('isAskDisabled', () => {
  it('enables wizard_ask in interactive runs by default', () => {
    expect(isAskDisabled({ ci: false, signup: false, e2eAsk: false })).toBe(
      false,
    );
  });

  it('auto-disables when running in CI mode', () => {
    expect(isAskDisabled({ ci: true, signup: false, e2eAsk: false })).toBe(
      true,
    );
  });

  it('auto-disables during the signup flow (which is non-interactive at the prompt layer)', () => {
    expect(isAskDisabled({ ci: false, signup: true, e2eAsk: false })).toBe(
      true,
    );
  });

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
      expect(isAskDisabled({ ci, signup, e2eAsk })).toBe(disabled);
    },
  );

  it('leaves a plain --ci session disabled — buildSession defaults e2eAsk to false', () => {
    const session = buildSession({ installDir: '/tmp/ask-policy', ci: true });
    expect(session.e2eAsk).toBe(false);
    expect(isAskDisabled(session)).toBe(true);
  });

  it('re-enables the bridge when the harness asks for it', () => {
    const session = buildSession({
      installDir: '/tmp/ask-policy',
      ci: true,
      e2eAsk: true,
    });
    expect(isAskDisabled(session)).toBe(false);
  });
});
