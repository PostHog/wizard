import axios, { AxiosError } from 'axios';
import {
  ApiError,
  fetchProjectData,
  fetchUserData,
  handleApiError,
  isTransientApiError,
} from '@shared/api';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const BASE_URL = 'https://us.posthog.com';

const USER_PAYLOAD = {
  distinct_id: 'user-123',
  team: { id: 42, organization: '11111111-1111-1111-1111-111111111111' },
  organization: { id: '11111111-1111-1111-1111-111111111111' },
  organizations: [],
};

/** A real AxiosError, so `axios.isAxiosError` recognises it. */
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

const noSleep = { sleepImpl: () => Promise.resolve() };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isTransientApiError', () => {
  it('treats 5xx, 408, 429, and no-response errors as transient', () => {
    for (const status of [408, 429, 503]) {
      expect(isTransientApiError(axiosError({ status }))).toBe(true);
    }
    expect(isTransientApiError(axiosError({ code: 'ECONNRESET' }))).toBe(true);
  });

  it('does not treat other 4xx or parse errors as transient', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(isTransientApiError(axiosError({ status }))).toBe(false);
    }
    expect(isTransientApiError(new Error('bad shape'))).toBe(false);
  });
});

describe('login lookups retry', () => {
  it('backs off exponentially with jitter between attempts', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(axiosError({ status: 502 }));
    const random = vi.spyOn(Math, 'random');
    const sleepImpl = vi.fn((_ms: number) => Promise.resolve());
    const waits = async (r: number) => {
      random.mockReturnValue(r);
      sleepImpl.mockClear();
      await expect(
        fetchUserData('token', BASE_URL, { sleepImpl }),
      ).rejects.toThrow(ApiError);
      return sleepImpl.mock.calls.map(([ms]) => ms);
    };

    expect(await waits(0)).toEqual([1000, 2000, 4000]);
    expect(await waits(0.5)).toEqual([1500, 3000, 6000]);
  });

  it('retries a transient failure and then succeeds', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(axiosError({ status: 502 }))
      .mockRejectedValueOnce(axiosError({ code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ data: USER_PAYLOAD });

    const user = await fetchUserData('token', BASE_URL, noSleep);

    expect(user.team.id).toBe(42);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('gives up after the last attempt with a clear message', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValue(axiosError({ status: 503 }));

    const error = await fetchProjectData('token', 1, BASE_URL, noSleep).catch(
      (e: unknown) => e,
    );

    expect(get).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toMatch(
      /temporarily unavailable \(HTTP 503\)/,
    );
    expect((error as ApiError).transient).toBe(true);
  });

  it('does not retry a 401', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValue(axiosError({ status: 401 }));

    await expect(fetchUserData('token', BASE_URL, noSleep)).rejects.toThrow(
      /Authentication failed/,
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('handleApiError', () => {
  it('names the network code and keeps the cause', () => {
    const cause = axiosError({ code: 'ETIMEDOUT' });
    const err = handleApiError(cause, 'fetch user data');

    expect(err.message).toMatch(/Could not reach PostHog .*\(ETIMEDOUT\)/);
    expect(err.cause).toBe(cause);
    expect(err.transient).toBe(true);
  });

  it('names the status of an unmapped 4xx', () => {
    const err = handleApiError(axiosError({ status: 400 }), 'fetch user data');
    expect(err.message).toBe('Failed to fetch user data (HTTP 400)');
    expect(err.transient).toBe(false);
  });
});
