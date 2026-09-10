import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import { z } from 'zod';
import { handleApiError, ApiError } from '@lib/api';

/** Build an AxiosError that carries an HTTP response with the given status. */
function responseError(status: number, url = '/api/users/@me/'): AxiosError {
  const error = new AxiosError('Request failed');
  error.config = { url } as never;
  error.response = {
    status,
    data: {},
    statusText: '',
    headers: {},
    config: {} as never,
  };
  return error;
}

/** Build an AxiosError with no response — a transport failure. */
function transportError(code: string, url = '/api/users/@me/'): AxiosError {
  const error = new AxiosError('connect error');
  error.config = { url } as never;
  error.code = code;
  return error;
}

describe('handleApiError', () => {
  it('maps 401/403/404 to distinct messages', () => {
    expect(handleApiError(responseError(401), 'fetch user data').message).toBe(
      'Authentication failed while trying to fetch user data',
    );
    expect(handleApiError(responseError(403), 'fetch user data').message).toBe(
      'Access denied while trying to fetch user data',
    );
    expect(handleApiError(responseError(404), 'fetch user data').message).toBe(
      'Resource not found while trying to fetch user data',
    );
  });

  it('puts the HTTP status in the message so 5xx and 429 group separately', () => {
    const server = handleApiError(responseError(500), 'fetch user data');
    const throttled = handleApiError(responseError(429), 'fetch user data');

    expect(server.message).toBe('Failed to fetch user data (HTTP 500)');
    expect(throttled.message).toBe('Failed to fetch user data (HTTP 429)');
    // Different causes must not collapse into one error tracking group.
    expect(server.message).not.toBe(throttled.message);
    expect(server.statusCode).toBe(500);
  });

  it('puts the transport code in the message when there is no response', () => {
    const dns = handleApiError(transportError('ENOTFOUND'), 'fetch user data');
    const reset = handleApiError(
      transportError('ECONNRESET'),
      'fetch user data',
    );

    expect(dns.message).toBe('Failed to fetch user data (ENOTFOUND)');
    expect(reset.message).toBe('Failed to fetch user data (ECONNRESET)');
    expect(dns.message).not.toBe(reset.message);
    expect(dns.statusCode).toBeUndefined();
  });

  it('reports a missing transport code without collapsing into a bare string', () => {
    const error = new AxiosError('connect error');
    error.config = { url: '/api/users/@me/' } as never;

    expect(handleApiError(error, 'fetch user data').message).toBe(
      'Failed to fetch user data (network error)',
    );
  });

  it('flags a schema mismatch separately from transport failures', () => {
    const zodError = new z.ZodError([]);
    expect(handleApiError(zodError, 'fetch user data').message).toBe(
      'Invalid response format while trying to fetch user data',
    );
  });

  it('returns an ApiError instance for every branch', () => {
    expect(handleApiError(responseError(500), 'x')).toBeInstanceOf(ApiError);
    expect(handleApiError(new Error('boom'), 'x')).toBeInstanceOf(ApiError);
  });
});
