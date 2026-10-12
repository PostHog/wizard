import type { Credentials } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';
import {
  markGrantRevoked,
  resetAuthSessionState,
} from '@shared/auth-session-state';
import {
  configureOAuthSession,
  resetOAuthSession,
  rotateAfterUnauthorized,
} from '../oauth-session';

describe('rotateAfterUnauthorized', () => {
  const credentials: Credentials = {
    accessToken: 'pha_first',
    refreshToken: 'phr_first',
    projectApiKey: 'phc_unused',
    projectId: 42,
    host: HostResolution.fromApiHost('https://eu.posthog.com'),
  };
  const rotate = vi.fn();
  const options = { requireRefreshToken: true };

  beforeEach(() => {
    rotate
      .mockReset()
      .mockImplementation((held: Credentials) =>
        Promise.resolve({ ...held, accessToken: 'pha_rotated' }),
      );
    resetOAuthSession();
    resetAuthSessionState();
    configureOAuthSession(credentials, { rotate });
  });

  afterEach(() => {
    resetOAuthSession();
    resetAuthSessionState();
  });

  it('returns the rotated credentials for a retry', async () => {
    const recovery = await rotateAfterUnauthorized(credentials, options);

    expect(recovery).toEqual({
      kind: 'rotated',
      credentials: expect.objectContaining({ accessToken: 'pha_rotated' }),
    });
  });

  it('does not rotate a revoked grant', async () => {
    markGrantRevoked();

    expect(await rotateAfterUnauthorized(credentials, options)).toEqual({
      kind: 'refused',
    });
    expect(rotate).not.toHaveBeenCalled();
  });

  it('does not retry when the rotation returns the same token', async () => {
    rotate.mockImplementation((held: Credentials) => Promise.resolve(held));

    expect(await rotateAfterUnauthorized(credentials, options)).toEqual({
      kind: 'unchanged',
    });
  });

  it('refuses a login with no refresh token only where the caller requires one', async () => {
    const bare = { ...credentials, refreshToken: undefined };
    resetOAuthSession();
    configureOAuthSession(bare, { rotate });

    expect(await rotateAfterUnauthorized(bare, options)).toEqual({
      kind: 'refused',
    });
    expect(
      await rotateAfterUnauthorized(bare, { requireRefreshToken: false }),
    ).toEqual({ kind: 'unchanged' });
  });
});
