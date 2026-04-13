import { canContinueBlockingOutage } from './outage-behavior.js';

describe('canContinueBlockingOutage', () => {
  it('allows continuing when GitHub Releases is healthy', () => {
    expect(
      canContinueBlockingOutage({
        isGithubReleasesDown: false,
        signup: false,
      }),
    ).toBe(true);
  });

  it('blocks non-signup runs when GitHub Releases is down', () => {
    expect(
      canContinueBlockingOutage({
        isGithubReleasesDown: true,
        signup: false,
      }),
    ).toBe(false);
  });

  it('allows signup runs to continue when GitHub Releases is down', () => {
    expect(
      canContinueBlockingOutage({
        isGithubReleasesDown: true,
        signup: true,
      }),
    ).toBe(true);
  });
});
