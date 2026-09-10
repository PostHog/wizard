import { extractNpmErrorCode } from '@utils/setup-utils';
import { hasDependencyOverrides } from '@utils/package-json';

describe('extractNpmErrorCode', () => {
  it('reads the code from npm 10+ output', () => {
    const output =
      'npm error code EOVERRIDE\nnpm error Override for posthog@1.15.0 conflicts with direct dependency';
    expect(extractNpmErrorCode(output)).toBe('EOVERRIDE');
  });

  it('reads the code from older npm output', () => {
    expect(extractNpmErrorCode('npm ERR! code ERESOLVE')).toBe('ERESOLVE');
  });

  it('returns undefined when no code is present', () => {
    expect(extractNpmErrorCode('some unrelated failure')).toBeUndefined();
  });
});

describe('hasDependencyOverrides', () => {
  it('is true for a non-empty npm overrides block', () => {
    expect(hasDependencyOverrides({ overrides: { posthog: '1.15.0' } })).toBe(
      true,
    );
  });

  it('is true for yarn resolutions', () => {
    expect(hasDependencyOverrides({ resolutions: { posthog: '1.15.0' } })).toBe(
      true,
    );
  });

  it('is true for pnpm overrides', () => {
    expect(
      hasDependencyOverrides({ pnpm: { overrides: { posthog: '1.15.0' } } }),
    ).toBe(true);
  });

  it('is false when no override block is declared', () => {
    expect(hasDependencyOverrides({ dependencies: { react: '19.0.0' } })).toBe(
      false,
    );
  });

  it('is false for an empty override block', () => {
    expect(hasDependencyOverrides({ overrides: {} })).toBe(false);
  });
});
