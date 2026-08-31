import { ensureFreshAccessToken } from '../authenticate';
import { refreshOAuthToken } from '@utils/oauth';
import type { WizardSession, Credentials } from '@lib/wizard-session';

vi.mock('@utils/oauth', () => ({ refreshOAuthToken: vi.fn() }));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

const setCredentials = vi.fn();
vi.mock('@ui', () => ({
  getUI: () => ({ setCredentials }),
}));

const mockedRefresh = refreshOAuthToken as Mock;

const HOUR_MS = 60 * 60 * 1000;

function sessionWith(credentials: Partial<Credentials> | null): WizardSession {
  return {
    baseUrl: undefined,
    credentials: credentials as Credentials | null,
  } as WizardSession;
}

describe('ensureFreshAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op without credentials', async () => {
    await ensureFreshAccessToken(sessionWith(null));
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('is a no-op without a refresh token (CI api-key runs, refresh-less grants)', async () => {
    await ensureFreshAccessToken(
      sessionWith({ accessToken: 'pha_ci_key', accessTokenExpiresAt: 0 }),
    );
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('skips a token that still has most of its lifetime left', async () => {
    await ensureFreshAccessToken(
      sessionWith({
        accessToken: 'pha_fresh',
        refreshToken: 'phr_x',
        accessTokenExpiresAt: Date.now() + HOUR_MS - 60_000,
      }),
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
    const session = sessionWith({
      accessToken: 'pha_old',
      refreshToken: 'phr_old',
      accessTokenExpiresAt: Date.now() + 20 * 60 * 1000,
    });

    await ensureFreshAccessToken(session);

    expect(mockedRefresh).toHaveBeenCalledWith('phr_old', undefined);
    expect(session.credentials!.accessToken).toBe('pha_new');
    expect(session.credentials!.refreshToken).toBe('phr_rotated');
    expect(session.credentials!.accessTokenExpiresAt).toBeGreaterThan(
      Date.now() + 3500 * 1000,
    );
    expect(setCredentials).toHaveBeenCalledWith(session.credentials);
  });

  it('refreshes when the expiry is unknown rather than gambling on a stale token', async () => {
    mockedRefresh.mockResolvedValueOnce({
      access_token: 'pha_new',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'project:read',
    });
    const session = sessionWith({
      accessToken: 'pha_old',
      refreshToken: 'phr_old',
    });

    await ensureFreshAccessToken(session);

    expect(session.credentials!.accessToken).toBe('pha_new');
    // No rotated token in the response — the old one stays usable.
    expect(session.credentials!.refreshToken).toBe('phr_old');
  });

  it('keeps the existing token and does not throw when the refresh fails', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('invalid_grant'));
    const session = sessionWith({
      accessToken: 'pha_old',
      refreshToken: 'phr_old',
      accessTokenExpiresAt: Date.now() + 20 * 60 * 1000,
    });

    await expect(ensureFreshAccessToken(session)).resolves.toBeUndefined();
    expect(session.credentials!.accessToken).toBe('pha_old');
    expect(setCredentials).not.toHaveBeenCalled();
  });
});
