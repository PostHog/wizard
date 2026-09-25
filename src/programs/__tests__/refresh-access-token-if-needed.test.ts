import { rotateCredentials } from '../credentials';
import { refreshAccessToken } from '@utils/oauth';
import { OAuthError } from '@utils/oauth-errors';
import {
  isGrantRevoked,
  resetAuthSessionState,
} from '@shared/auth-session-state';
import {
  configureOAuthSession,
  oauthCredentials,
  resetOAuthSession,
} from '@shared/oauth-session';
import type { Credentials } from '@shared/api';

vi.mock('@utils/oauth', async (original) => ({
  ...(await original<typeof import('@utils/oauth')>()),
  refreshAccessToken: vi.fn(),
}));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
  groupsFromUser: vi.fn(),
}));
// The real @utils/oauth loads the UI module.
vi.mock('@ui', () => ({ getUI: vi.fn() }));

const mockedRefresh = refreshAccessToken as Mock;

/** The pre-run refresh runProgram does: the OAuth session decides, this grant rotates. */
async function refresh(
  credentials: Partial<Credentials>,
  baseUrl?: string,
): Promise<Credentials> {
  configureOAuthSession(credentials as Credentials, {
    rotate: (held) => rotateCredentials(held, baseUrl),
  });
  return (await oauthCredentials())!;
}

/** Aging enough to be under the 50-minute threshold. */
const aging = (over: Partial<Credentials> = {}): Partial<Credentials> => ({
  accessToken: 'pha_old',
  refreshToken: 'phr_old',
  expiresAt: Date.now() + 20 * 60 * 1000,
  ...over,
});

describe('rotateCredentials through the OAuth session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthSessionState();
    resetOAuthSession();
  });

  it('is a no-op without a refresh token (CI api-key runs, refresh-less grants)', async () => {
    await refresh({ accessToken: 'pha_ci_key', expiresAt: 0 });
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('skips a token that still has most of its lifetime left', async () => {
    await refresh(aging({ expiresAt: Date.now() + 59 * 60 * 1000 }));
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  // `?? 0` would read as "expired" and spend a rotation on every run.
  it('skips a credential carrying a refresh token but no expiry', async () => {
    await refresh({ accessToken: 'pha_old', refreshToken: 'phr_old' });
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('refreshes an aging token and stores the rotated refresh token', async () => {
    mockedRefresh.mockResolvedValueOnce({
      access_token: 'pha_new',
      refresh_token: 'phr_rotated',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'project:read',
    });
    const refreshed = await refresh(
      aging({ projectId: 7 }),
      'https://posthog.example',
    );

    expect(mockedRefresh).toHaveBeenCalledWith(
      'phr_old',
      'https://posthog.example',
      undefined,
    );
    expect(refreshed.accessToken).toBe('pha_new');
    expect(refreshed.refreshToken).toBe('phr_rotated');
    // Unrelated fields survive the swap.
    expect(refreshed.projectId).toBe(7);
  });

  it('refreshes under the minting client id when the credential carries one (provisioning signups)', async () => {
    mockedRefresh.mockResolvedValueOnce({
      access_token: 'pha_new',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'project:read',
    });

    await refresh(aging({ oauthClientId: 'client_us_provisioning' }));

    expect(mockedRefresh).toHaveBeenCalledWith(
      'phr_old',
      undefined,
      'client_us_provisioning',
    );
  });

  it('replaces the credentials object rather than mutating it in place', async () => {
    mockedRefresh.mockResolvedValueOnce({
      access_token: 'pha_new',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'project:read',
    });
    const before = aging();

    const refreshed = await refresh(before);

    expect(refreshed).not.toBe(before);
    expect(before.accessToken).toBe('pha_old');
    // No rotation in the response: the old refresh token has to carry over.
    expect(refreshed.refreshToken).toBe('phr_old');
  });

  it('keeps the existing token and does not throw when the refresh fails', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('network down'));
    const before = aging();

    await expect(refresh(before)).resolves.toBe(before);
  });

  it('marks the grant revoked on invalid_grant, so a later 401 can name the cause', async () => {
    mockedRefresh.mockRejectedValueOnce(new OAuthError('invalid_grant'));

    await refresh(aging());

    expect(isGrantRevoked()).toBe(true);
  });

  it('leaves the grant unmarked for a transport failure, which says nothing about the login', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await refresh(aging());

    expect(isGrantRevoked()).toBe(false);
  });
});
