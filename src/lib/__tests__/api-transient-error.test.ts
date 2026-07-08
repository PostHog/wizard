import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { isTransientApiError } from '@lib/api';

/**
 * Contract test for `isTransientApiError` — the classifier that keeps the
 * Slack connectivity poll from reporting recoverable server/network blips
 * to error tracking. A transient error means "retry on the next tick"; a
 * non-transient one means "capture once and stop".
 */
function axiosErrorWithStatus(status: number): AxiosError {
  const err = new AxiosError('request failed');
  err.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

function axiosErrorWithCode(code: string): AxiosError {
  const err = new AxiosError('request failed');
  err.code = code;
  return err;
}

describe('isTransientApiError', () => {
  it('treats gateway statuses (502/503/504) as transient', () => {
    expect(isTransientApiError(axiosErrorWithStatus(502))).toBe(true);
    expect(isTransientApiError(axiosErrorWithStatus(503))).toBe(true);
    expect(isTransientApiError(axiosErrorWithStatus(504))).toBe(true);
  });

  it('treats client timeouts and stalled sockets as transient', () => {
    expect(isTransientApiError(axiosErrorWithCode('ECONNABORTED'))).toBe(true);
    expect(isTransientApiError(axiosErrorWithCode('ETIMEDOUT'))).toBe(true);
  });

  it('treats a network error with no response as transient', () => {
    expect(isTransientApiError(axiosErrorWithCode('ERR_NETWORK'))).toBe(true);
  });

  it('does not treat genuine HTTP errors as transient', () => {
    expect(isTransientApiError(axiosErrorWithStatus(401))).toBe(false);
    expect(isTransientApiError(axiosErrorWithStatus(403))).toBe(false);
    expect(isTransientApiError(axiosErrorWithStatus(404))).toBe(false);
    expect(isTransientApiError(axiosErrorWithStatus(500))).toBe(false);
  });

  it('does not treat non-axios errors as transient', () => {
    expect(isTransientApiError(new Error('boom'))).toBe(false);
    expect(isTransientApiError('nope')).toBe(false);
    expect(isTransientApiError(undefined)).toBe(false);
  });
});
