import { refreshAccessTokenIfNeeded } from '../authenticate';
import { refreshAccessToken } from '@utils/oauth';
import { OAuthError } from '@utils/oauth-errors';
import { isGrantRevoked, resetAuthSessionState } from '@lib/auth-session-state';
import type { WizardSession, Credentials } from '@lib/wizard-session';

vi.mock('@utils/oauth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
  groupsFromUser: vi.fn(),
}));

const setAccessToken = vi.fn();
vi.mock('@ui', () => ({
  getUI: () => ({ setAccessToken }),
}));

const mockedRefresh = refreshAccessToken as Mock;

function sessionWith(credentials: Partial<Credentials> | null): WizardSession {
  return { credentials: credentials as Credentials | null } as WizardSession;
}

/** Aging enough to be under the 50-minute threshold. */
const aging = (over: Partial<Credentials> = {}): Partial<Credentials> => ({
  accessToken: 'pha_old',
  refreshToken: 'phr_old',
  expiresAt: Date.now() + 20 * 60 * 1000,
  ...over,
});

describe('refreshAccessTokenIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthSessionState();
  });

  it('is a no-op without a refresh token (CI api-key runs, refresh-less grants)', async () => {
    await refreshAccessTokenIfNeeded(sessionWith(null));
    await refreshAccessTokenIfNeeded(
      sessionWith({ accessToken: 'pha_ci_key', expiresAt: 0 }),
    );
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('skips a token that still has most of its lifetime left', async () => {
    await refreshAccessTokenIfNeeded(
      sessionWith(aging({ expiresAt: Date.now() + 59 * 60 * 1000 })),
    );
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  // `?? 0` would read as "expired" and spend a rotation on every run.
  it('skips a credential carrying a refresh token but no expiry', async () => {
    await refreshAccessTokenIfNeeded(
      sessionWith({ accessToken: 'pha_old', refreshToken: 'phr_old' }),
    );
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
    const session = sessionWith(aging({ projectId: 7 }));

    await refreshAccessTokenIfNeeded(session);

    expect(mockedRefresh).toHaveBeenCalledWith('phr_old', undefined);
    expect(session.credentials!.accessToken).toBe('pha_new');
    expect(session.credentials!.refreshToken).toBe('phr_rotated');
    // Unrelated fields survive the swap.
    expect(session.credentials!.projectId).toBe(7);
    expect(setAccessToken).toHaveBeenCalledWith(session.credentials);
  });

  it('replaces the credentials object rather than mutating it in place', async () => {
    mockedRefresh.mockResolvedValueOnce({
      access_token: 'pha_new',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'project:read',
    });
    const session = sessionWith(aging());
    const before = session.credentials;

    await refreshAccessTokenIfNeeded(session);

    expect(session.credentials).not.toBe(before);
    expect(before!.accessToken).toBe('pha_old');
    // No rotation in the response: the old refresh token has to carry over.
    expect(session.credentials!.refreshToken).toBe('phr_old');
  });

  it('keeps the existing token and does not throw when the refresh fails', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('network down'));
    const session = sessionWith(aging());

    await expect(refreshAccessTokenIfNeeded(session)).resolves.toBeUndefined();
    expect(session.credentials!.accessToken).toBe('pha_old');
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('marks the grant revoked on invalid_grant, so a later 401 can name the cause', async () => {
    mockedRefresh.mockRejectedValueOnce(new OAuthError('invalid_grant'));

    await refreshAccessTokenIfNeeded(sessionWith(aging()));

    expect(isGrantRevoked()).toBe(true);
  });

  it('leaves the grant unmarked for a transport failure, which says nothing about the login', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await refreshAccessTokenIfNeeded(sessionWith(aging()));

    expect(isGrantRevoked()).toBe(false);
  });
});
