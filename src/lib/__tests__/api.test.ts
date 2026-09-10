import axios from 'axios';
import { ApiError, fetchSlackConnected } from '@lib/api';

vi.mock('axios');

const mockedAxios = axios as Mocked<typeof axios>;

describe('fetchSlackConnected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // handleApiError branches on axios.isAxiosError; the auto-mock returns
    // undefined by default, so restore real error detection.
    mockedAxios.isAxiosError.mockImplementation(
      (payload: unknown): payload is import('axios').AxiosError =>
        typeof payload === 'object' &&
        payload !== null &&
        'isAxiosError' in payload,
    );
  });

  it('returns true when a Slack integration is present', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { results: [{ kind: 'slack' }] },
    });

    await expect(
      fetchSlackConnected('token', 1, 'https://us.posthog.com'),
    ).resolves.toBe(true);
  });

  it('returns false when no Slack integration is present', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { results: [{ kind: 'github' }] },
    });

    await expect(
      fetchSlackConnected('token', 1, 'https://us.posthog.com'),
    ).resolves.toBe(false);
  });

  // The reported symptom: a 401 (expired/invalid token) used to bubble up as
  // a raw AxiosError with a bundled dist/ stack. It must surface as a typed
  // ApiError carrying the status code so the poll can degrade quietly.
  it('throws a typed ApiError (not a raw AxiosError) on 401', async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: {} },
      config: { url: '/api/projects/1/integrations/' },
    });

    const error = await fetchSlackConnected(
      'token',
      1,
      'https://us.posthog.com',
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(401);
  });

  it('throws a typed ApiError carrying the 403 status', async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 403, data: {} },
      config: { url: '/api/projects/1/integrations/' },
    });

    const error = await fetchSlackConnected(
      'token',
      1,
      'https://us.posthog.com',
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(403);
  });
});
