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

function sessionWith(credentials: Partial<Credentials> | null): WizardSession {
  return { credentials: credentials as Credentials | null } as WizardSession;
}

describe('ensureFreshAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op without a refresh token (CI api-key runs, refresh-less grants)', async () => {
    await ensureFreshAccessToken(sessionWith(null));
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
        accessTokenExpiresAt: Date.now() + 59 * 60 * 1000,
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
    expect(setCredentials).toHaveBeenCalledWith(session.credentials);
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
