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

  it('returns the same credentials without a refresh token (CI api-key runs, refresh-less grants)', async () => {
    const apiKey = credentialsWith({ accessToken: 'pha_ci_key', expiresAt: 0 });

    await expect(refreshCredentialsIfNeeded(apiKey, {})).resolves.toBe(apiKey);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('returns the same credentials while most of the lifetime is left', async () => {
    const fresh = aging({ expiresAt: Date.now() + 59 * 60 * 1000 });

    await expect(refreshCredentialsIfNeeded(fresh, {})).resolves.toBe(fresh);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  // `?? 0` would read as "expired" and spend a rotation on every run.
  it('returns the same credentials when they carry a refresh token but no expiry', async () => {
    const noExpiry = credentialsWith({ refreshToken: 'phr_old' });

    await expect(refreshCredentialsIfNeeded(noExpiry, {})).resolves.toBe(
      noExpiry,
    );
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('refreshes an aging token against the base URL and keeps the rotated refresh token', async () => {
    mockedRefresh.mockResolvedValueOnce(
      token({ refresh_token: 'phr_rotated' }),
    );

    const refreshed = await refreshCredentialsIfNeeded(aging(), {
      baseUrl: 'https://posthog.example',
    });

    expect(mockedRefresh).toHaveBeenCalledWith(
      'phr_old',
      'https://posthog.example',
      undefined,
    );
    expect(refreshed.accessToken).toBe('pha_new');
    expect(refreshed.refreshToken).toBe('phr_rotated');
    // Unrelated fields survive the swap.
    expect(refreshed.projectId).toBe(7);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
  });

  it('refreshes under the minting client id when the credentials carry one (provisioning signups)', async () => {
    mockedRefresh.mockResolvedValueOnce(token());

    await refreshCredentialsIfNeeded(
      aging({ oauthClientId: 'client_us_provisioning' }),
      {},
    );

    expect(mockedRefresh).toHaveBeenCalledWith(
      'phr_old',
      undefined,
      'client_us_provisioning',
    );
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

  it('returns the same credentials and does not throw when the refresh fails', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('network down'));
    const before = aging();

    await expect(refreshCredentialsIfNeeded(before, {})).resolves.toBe(before);
    expect(before.accessToken).toBe('pha_old');
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

  it('leaves the grant unmarked for a transport failure, which says nothing about the login', async () => {
    mockedRefresh.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await refreshCredentialsIfNeeded(aging(), {});

    expect(isGrantRevoked()).toBe(false);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });
});
