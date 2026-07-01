import axios, { AxiosError, CanceledError } from 'axios';
import { fetchSlackConnected, ApiError } from '@lib/api';

// Partially mock axios: stub `get`, keep the real `isAxiosError` / `isCancel`
// type guards and the real `AxiosError` / `CanceledError` classes so the
// transient-vs-genuine classifier behaves as it does in production.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: { ...actual.default, get: vi.fn() },
  };
});

// Avoid real backoff delays.
vi.mock('@lib/helper-functions', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const mockedGet = axios.get as unknown as ReturnType<typeof vi.fn>;

const ACCESS_TOKEN = 'phx_test';
const PROJECT_ID = 42;
const BASE_URL = 'https://us.posthog.com';

function ok(kinds: string[]) {
  return { data: { results: kinds.map((kind) => ({ kind })) } };
}

/** A gateway 5xx AxiosError (has an HTTP response). */
function httpError(status: number): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    {},
    { status, data: {}, statusText: '', headers: {}, config: {} as never },
  );
}

/** A transport-layer AxiosError (no HTTP response) carrying a code. */
function networkError(message: string, code?: string): AxiosError {
  return new AxiosError(message, code);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchSlackConnected', () => {
  it('returns true when a slack integration is present', async () => {
    mockedGet.mockResolvedValueOnce(ok(['slack', 'github']));
    await expect(
      fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL),
    ).resolves.toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('returns false when no slack integration is present', async () => {
    mockedGet.mockResolvedValueOnce(ok(['github']));
    await expect(
      fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL),
    ).resolves.toBe(false);
  });

  it('sends a timeout on the request', async () => {
    mockedGet.mockResolvedValueOnce(ok([]));
    await fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL);
    expect(mockedGet.mock.calls[0][1]).toMatchObject({
      timeout: expect.any(Number),
    });
  });

  it('retries a 504 and succeeds on a later attempt', async () => {
    mockedGet
      .mockRejectedValueOnce(httpError(504))
      .mockResolvedValueOnce(ok(['slack']));
    await expect(
      fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL),
    ).resolves.toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['504 gateway timeout', () => httpError(504)],
    ['502 bad gateway', () => httpError(502)],
    ['503 service unavailable', () => httpError(503)],
    [
      'read EADDRNOTAVAIL',
      () => networkError('read EADDRNOTAVAIL', 'EADDRNOTAVAIL'),
    ],
    ['ECONNRESET', () => networkError('socket hang up', 'ECONNRESET')],
    [
      'axios timeout',
      () => networkError('timeout of 5000ms exceeded', 'ECONNABORTED'),
    ],
    [
      'TLS handshake disconnect (no code)',
      () =>
        networkError(
          'Client network socket disconnected before secure TLS connection was established',
        ),
    ],
  ])(
    'degrades to false (no throw) after exhausting retries on %s',
    async (_label, makeError) => {
      mockedGet.mockRejectedValue(makeError());
      await expect(
        fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL),
      ).resolves.toBe(false);
      // 1 initial attempt + 2 retries.
      expect(mockedGet).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    ['401 unauthorized', () => httpError(401)],
    ['403 forbidden', () => httpError(403)],
    ['404 not found', () => httpError(404)],
  ])(
    'throws on genuine, non-transient %s without retrying',
    async (_l, makeError) => {
      mockedGet.mockRejectedValue(makeError());
      await expect(
        fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL),
      ).rejects.toBeInstanceOf(ApiError);
      expect(mockedGet).toHaveBeenCalledTimes(1);
    },
  );

  it('throws an ApiError on a malformed 200 response', async () => {
    mockedGet.mockResolvedValueOnce({ data: { unexpected: true } });
    await expect(
      fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('propagates a caller-initiated cancellation without retrying', async () => {
    mockedGet.mockRejectedValue(new CanceledError('canceled'));
    await expect(
      fetchSlackConnected(ACCESS_TOKEN, PROJECT_ID, BASE_URL),
    ).rejects.toBeInstanceOf(CanceledError);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('throws without a request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchSlackConnected(
        ACCESS_TOKEN,
        PROJECT_ID,
        BASE_URL,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockedGet).not.toHaveBeenCalled();
  });
});
