import { keyPrefixWarning } from '../ci-install';

/**
 * `--ci` and headless accept the same credentials: a personal API key and a
 * wizard-app OAuth access token (the CI bot's). Only unknown prefixes warn.
 */
describe('keyPrefixWarning', () => {
  test('a personal API key (phx_) is accepted', () => {
    expect(keyPrefixWarning('phx_abc')).toBeNull();
  });

  test('a wizard-app OAuth access token (pha_) is accepted', () => {
    // The CI bot authenticates the mint with one of these; a warning here
    // would name the sanctioned credential as a mistake on every CI run.
    expect(keyPrefixWarning('pha_abc')).toBeNull();
  });

  test('no key returns no warning', () => {
    expect(keyPrefixWarning(undefined)).toBeNull();
  });

  test('a project/client key (phc_) warns and names both accepted kinds', () => {
    expect(keyPrefixWarning('phc_abc')).toMatch(/phc_/);
    expect(keyPrefixWarning('phc_abc')).toMatch(/"phx_" or "pha_"/);
  });

  test('an unknown prefix warns', () => {
    expect(keyPrefixWarning('sk-abc')).toMatch(/does not start with/);
  });
});
