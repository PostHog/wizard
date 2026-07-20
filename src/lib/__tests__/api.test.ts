import axios, { AxiosError } from 'axios';
import {
  fetchUserData,
  handleApiError,
  isTransientApiError,
  ApiError,
} from '@lib/api';

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const BASE_URL = 'https://us.posthog.com';

// A valid `/api/users/@me/` payload for the happy path / final success.
const USER_PAYLOAD = {
  distinct_id: 'user-123',
  team: {
    id: 42,
    organization: '11111111-1111-1111-1111-111111111111',
  },
  organization: {
    id: '11111111-1111-1111-1111-111111111111',
  },
  organizations: [],
};

/** Build a real AxiosError so `axios.isAxiosError` recognises it. */
function axiosError(opts: { status?: number; code?: string }): AxiosError {
  const err = new AxiosError('boom', opts.code, {
    url: '/api/users/@me/',
  } as never);
  if (opts.status != null) {
    err.response = {
      status: opts.status,
      data: {},
      statusText: '',
      headers: {},
      config: {} as never,
    };
  }
  return err;
}

// No real waiting between retries.
const noSleep = { sleepImpl: () => Promise.resolve(), backoffsMs: [1, 1, 1] };

describe('isTransientApiError', () => {
  it('treats 5xx as transient', () => {
    expect(isTransientApiError(axiosError({ status: 500 }))).toBe(true);
    expect(isTransientApiError(axiosError({ status: 503 }))).toBe(true);
  });

  it('treats network / timeout errors (no response) as transient', () => {
    expect(isTransientApiError(axiosError({ code: 'ECONNABORTED' }))).toBe(
      true,
    );
    expect(isTransientApiError(axiosError({ code: 'ECONNRESET' }))).toBe(true);
  });

  it('does not retry 4xx', () => {
    for (const status of [400, 401, 403, 404, 429]) {
      expect(isTransientApiError(axiosError({ status }))).toBe(false);
    }
  });

  it('does not retry non-axios errors (e.g. Zod parse failures)', () => {
    expect(isTransientApiError(new Error('bad shape'))).toBe(false);
  });
});

describe('fetchUserData retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a transient 5xx and then succeeds', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(axiosError({ status: 503 }))
      .mockRejectedValueOnce(axiosError({ status: 500 }))
      .mockResolvedValueOnce({ data: USER_PAYLOAD });

    const user = await fetchUserData('token', BASE_URL, noSleep);

    expect(user.team.id).toBe(42);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('retries a network error and then succeeds', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(axiosError({ code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ data: USER_PAYLOAD });

    const user = await fetchUserData('token', BASE_URL, noSleep);

    expect(user.distinct_id).toBe('user-123');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries and surfaces a clear 5xx message', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValue(axiosError({ status: 502 }));

    await expect(fetchUserData('token', BASE_URL, noSleep)).rejects.toThrow(
      /temporarily unavailable \(HTTP 502\)/,
    );
    // 1 initial + 3 retries.
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('surfaces a clear network message when retries are exhausted', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(
      axiosError({ code: 'ECONNABORTED' }),
    );

    await expect(fetchUserData('token', BASE_URL, noSleep)).rejects.toThrow(
      /Could not reach PostHog's API/,
    );
  });

  it('does not retry a 403 and fails fast', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValue(axiosError({ status: 403 }));

    await expect(fetchUserData('token', BASE_URL, noSleep)).rejects.toThrow(
      /Access denied/,
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('handleApiError', () => {
  it('maps 5xx to a temporary-unavailability message', () => {
    const err = handleApiError(axiosError({ status: 500 }), 'fetch user data');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toMatch(/temporarily unavailable/);
  });

  it('maps a no-response error to a connectivity message', () => {
    const err = handleApiError(
      axiosError({ code: 'ECONNABORTED' }),
      'fetch user data',
    );
    expect(err.message).toMatch(/Could not reach PostHog's API/);
  });
});
