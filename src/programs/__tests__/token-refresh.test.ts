import { refreshCredentialsIfNeeded } from '../token-refresh';
import { refreshAccessToken } from '@utils/oauth-token';
import { OAuthError } from '@utils/oauth-errors';
import { analytics } from '@utils/analytics';
import {
  isGrantRevoked,
  resetAuthSessionState,
} from '@shared/auth-session-state';
import type { Credentials } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';

vi.mock('@utils/oauth-token', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

const mockedRefresh = vi.mocked(refreshAccessToken);

function credentialsWith(over: Partial<Credentials> = {}): Credentials {
  return {
    accessToken: 'pha_old',
    projectApiKey: 'phc_test',
    projectId: 7,
    host: HostResolution.fromRegion('us'),
    ...over,
  };
}

/** Aging enough to be under the 50-minute threshold. */
const aging = (over: Partial<Credentials> = {}): Credentials =>
  credentialsWith({
    refreshToken: 'phr_old',
    expiresAt: Date.now() + 20 * 60 * 1000,
    ...over,
  });

const token = (over: Record<string, unknown> = {}) => ({
  access_token: 'pha_new',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: 'project:read',
  ...over,
});

describe('refreshCredentialsIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthSessionState();
  });

  it.each([
    [
      'without a refresh token (CI api-key runs, refresh-less grants)',
      credentialsWith({ accessToken: 'pha_ci_key', expiresAt: 0 }),
    ],
    [
      'while most of the lifetime is left',
      aging({ expiresAt: Date.now() + 59 * 60 * 1000 }),
    ],
    // `?? 0` would read as "expired" and spend a rotation on every run.
    [
      'with a refresh token but no expiry',
      credentialsWith({ refreshToken: 'phr_old' }),
    ],
  ])('returns the same credentials %s', async (_case, credentials) => {
    await expect(refreshCredentialsIfNeeded(credentials, {})).resolves.toBe(
      credentials,
    );
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('refreshes an aging token under the base URL and minting client id, and keeps the rotated refresh token', async () => {
    mockedRefresh.mockResolvedValueOnce(
      token({ refresh_token: 'phr_rotated' }),
    );

    const refreshed = await refreshCredentialsIfNeeded(
      aging({ oauthClientId: 'client_us_provisioning' }),
      { baseUrl: 'https://posthog.example' },
    );

    expect(mockedRefresh).toHaveBeenCalledWith(
      'phr_old',
      'https://posthog.example',
      'client_us_provisioning',
    );
    expect(refreshed.accessToken).toBe('pha_new');
    expect(refreshed.refreshToken).toBe('phr_rotated');
    // Unrelated fields survive the swap.
    expect(refreshed.projectId).toBe(7);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
  });

  it('returns new credentials rather than mutating the old ones', async () => {
    mockedRefresh.mockResolvedValueOnce(token());
    const before = aging();

    const refreshed = await refreshCredentialsIfNeeded(before, {});

    expect(refreshed).not.toBe(before);
    expect(before.accessToken).toBe('pha_old');
    // No rotation in the response: the old refresh token has to carry over.
    expect(refreshed.refreshToken).toBe('phr_old');
  });

  it('marks the grant revoked on invalid_grant, so a later 401 can name the cause', async () => {
    mockedRefresh.mockRejectedValueOnce(new OAuthError('invalid_grant'));

    await refreshCredentialsIfNeeded(aging(), {});

    expect(isGrantRevoked()).toBe(true);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'auth session expired',
      { reason: 'invalid_grant' },
    );
  });

  it('keeps the same credentials and leaves the grant unmarked for a transport failure, which says nothing about the login', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const before = aging();

    await expect(refreshCredentialsIfNeeded(before, {})).resolves.toBe(before);
    expect(before.accessToken).toBe('pha_old');
    expect(isGrantRevoked()).toBe(false);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });
});
