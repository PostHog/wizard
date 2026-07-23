import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { ApiError, fetchUserData, handleApiError } from '@lib/api';
import { analytics } from '@utils/analytics';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const captureMock = analytics.captureException as unknown as Mock;

function makeAxiosError(opts: {
  status?: number;
  code?: string;
  message?: string;
  detail?: string;
  url?: string;
}): AxiosError {
  const config = { url: opts.url } as never;
  const response =
    opts.status !== undefined
      ? ({
          status: opts.status,
          data: opts.detail ? { detail: opts.detail } : {},
          statusText: '',
          headers: {},
          config,
        } as never)
      : undefined;
  return new AxiosError(
    opts.message ?? 'boom',
    opts.code,
    config,
    {},
    response,
  );
}

describe('handleApiError', () => {
  it('maps 401 to an auth error', () => {
    const err = handleApiError(
      makeAxiosError({ status: 401, url: '/api/users/@me/' }),
      'fetch user data',
    );
    expect(err.kind).toBe('auth');
    expect(err.statusCode).toBe(401);
    expect(err.endpoint).toBe('/api/users/@me/');
    expect(err.isTransient).toBe(false);
  });

  it('classifies a no-response failure as a network error and keeps the code', () => {
    const err = handleApiError(
      makeAxiosError({ code: 'ENOTFOUND', url: '/api/users/@me/' }),
      'fetch user data',
    );
    expect(err.kind).toBe('network');
    expect(err.statusCode).toBeUndefined();
    expect(err.endpoint).toBe('/api/users/@me/');
    expect(err.message).toContain('ENOTFOUND');
    expect(err.isTransient).toBe(true);
  });

  it('classifies a timeout as a timeout error', () => {
    const err = handleApiError(
      makeAxiosError({ code: 'ECONNABORTED', message: 'timeout of 0ms' }),
      'fetch user data',
    );
    expect(err.kind).toBe('timeout');
    expect(err.message).toContain('timed out');
    expect(err.isTransient).toBe(true);
  });

  it('carries the status for a 5xx server error', () => {
    const err = handleApiError(
      makeAxiosError({ status: 503, detail: 'upstream down' }),
      'fetch user data',
    );
    expect(err.kind).toBe('server');
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain('503');
    expect(err.message).toContain('upstream down');
    expect(err.isTransient).toBe(true);
  });

  it('includes the status on an otherwise-uncategorised 4xx', () => {
    const err = handleApiError(
      makeAxiosError({ status: 429 }),
      'fetch user data',
    );
    expect(err.kind).toBe('client');
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('429');
    expect(err.isTransient).toBe(false);
  });

  it('classifies a schema mismatch as a parse error', () => {
    const zodError = new z.ZodError([
      { code: 'custom', path: ['distinct_id'], message: 'Required' } as never,
    ]);
    const err = handleApiError(zodError, 'fetch user data');
    expect(err.kind).toBe('parse');
    expect(err.isTransient).toBe(false);
    expect(err.message).toContain('distinct_id');
  });

  it('exposes status, endpoint, kind, and cause via toProperties', () => {
    const err = handleApiError(
      makeAxiosError({
        code: 'ECONNRESET',
        message: 'socket hang up',
        url: '/api/users/@me/',
      }),
      'fetch user data',
    );
    expect(err.message).toContain('ECONNRESET');
    expect(err.toProperties()).toMatchObject({
      endpoint: '/api/users/@me/',
      statusCode: undefined,
      error_kind: 'network',
      cause: 'socket hang up',
    });
  });
});

const VALID_USER = {
  distinct_id: 'user-123',
  team: { id: 1, organization: '00000000-0000-0000-0000-000000000000' },
  organization: { id: '00000000-0000-0000-0000-000000000000' },
  organizations: [],
};

describe('fetchUserData retry', () => {
  beforeEach(() => {
    captureMock.mockClear();
    vi.restoreAllMocks();
  });

  it('returns parsed data without retrying on first success', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: VALID_USER } as never);
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const user = await fetchUserData('token', 'https://us.posthog.com', {
      sleepImpl,
    });

    expect(user.distinct_id).toBe('user-123');
    expect(get).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('retries a transient failure with backoff then succeeds', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(makeAxiosError({ code: 'ETIMEDOUT' }))
      .mockRejectedValueOnce(makeAxiosError({ status: 502 }))
      .mockResolvedValue({ data: VALID_USER } as never);
    const sleeps: number[] = [];
    const sleepImpl = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };

    const user = await fetchUserData('token', 'https://us.posthog.com', {
      backoffMs: 300,
      sleepImpl,
    });

    expect(user.distinct_id).toBe('user-123');
    expect(get).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([300, 600]);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('does not retry a non-transient failure and captures once with enriched props', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValue(
        makeAxiosError({ status: 403, url: '/api/users/@me/' }),
      );
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchUserData('token', 'https://us.posthog.com', { sleepImpl }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(get).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][1]).toMatchObject({
      endpoint: '/api/users/@me/',
      statusCode: 403,
      error_kind: 'forbidden',
    });
  });

  it('exhausts retries on persistent transient failure then throws', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockRejectedValue(makeAxiosError({ code: 'ECONNREFUSED' }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchUserData('token', 'https://us.posthog.com', {
        maxAttempts: 3,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: 'network' });

    expect(get).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][1]).toMatchObject({
      error_kind: 'network',
      attempts: 3,
    });
  });
});
