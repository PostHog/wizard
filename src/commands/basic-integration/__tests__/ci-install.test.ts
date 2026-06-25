import { keyPrefixWarning } from '../ci-install';

/**
 * `keyPrefixWarning` is the one behavioral fork between `--ci` and headless
 * mode: headless accepts a `pha_` OAuth access token as first-class, CI does
 * not. Everything else about the two modes is shared.
 */
describe('keyPrefixWarning', () => {
  describe.each([false, true])('headless=%s', (headless) => {
    test('a personal API key (phx_) is always accepted', () => {
      expect(keyPrefixWarning('phx_abc', headless)).toBeNull();
    });

    test('no key returns no warning', () => {
      expect(keyPrefixWarning(undefined, headless)).toBeNull();
    });

    test('a project/client key (phc_) always warns', () => {
      expect(keyPrefixWarning('phc_abc', headless)).toMatch(/phc_/);
    });
  });

  test('headless accepts a pha_ OAuth access token without warning', () => {
    expect(keyPrefixWarning('pha_abc', true)).toBeNull();
  });

  test('CI mode warns on a pha_ OAuth access token', () => {
    const warning = keyPrefixWarning('pha_abc', false);
    expect(warning).toMatch(/OAuth access token/);
  });
});
