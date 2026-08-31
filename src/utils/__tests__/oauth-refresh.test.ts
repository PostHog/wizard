import axios from 'axios';
import { refreshOAuthToken } from '@utils/oauth';
import { POSTHOG_PROXY_CLIENT_ID } from '@lib/constants';

vi.mock('axios');
// No base-URL override resolves to prod routing (kills IS_DEV's implicit localhost).
vi.mock('../urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../urls')>()),
  resolveBaseUrl: (baseUrl?: string) => baseUrl,
}));
vi.mock('../debug', () => ({ logToFile: vi.fn() }));

const mockedAxios = axios as Mocked<typeof axios>;

describe('refreshOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts a refresh_token grant with the proxy client id and parses the response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'pha_new_access',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'project:read event_definition:write',
        refresh_token: 'phr_rotated',
      },
    });

    const token = await refreshOAuthToken('phr_old');

    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toMatch(/\/oauth\/token$/);
    expect(body).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'phr_old',
      client_id: POSTHOG_PROXY_CLIENT_ID,
    });
    expect(token.access_token).toBe('pha_new_access');
    expect(token.refresh_token).toBe('phr_rotated');
  });

  it('propagates a failed refresh instead of returning a stale token', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('invalid_grant'));

    await expect(refreshOAuthToken('phr_revoked')).rejects.toThrow(
      'invalid_grant',
    );
  });
});
