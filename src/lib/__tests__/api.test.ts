import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { isAuthOrScopeError } from '@lib/api';

/**
 * `isAuthOrScopeError` gates whether a caller reports a failure to error
 * tracking. The Slack connect poll 403s when the token lacks
 * `integration:read` — an expected, gracefully-handled outcome that must
 * NOT be captured as a bug. Only genuinely unexpected failures should be.
 */
const axiosErrorWithStatus = (status: number): AxiosError => {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return error;
};

describe('isAuthOrScopeError', () => {
  it('treats 401 (unauthenticated) as an auth/scope error', () => {
    expect(isAuthOrScopeError(axiosErrorWithStatus(401))).toBe(true);
  });

  it('treats 403 (missing scope) as an auth/scope error', () => {
    expect(isAuthOrScopeError(axiosErrorWithStatus(403))).toBe(true);
  });

  it('does not treat other HTTP failures as auth/scope errors', () => {
    expect(isAuthOrScopeError(axiosErrorWithStatus(404))).toBe(false);
    expect(isAuthOrScopeError(axiosErrorWithStatus(500))).toBe(false);
  });

  it('does not treat non-axios errors as auth/scope errors', () => {
    expect(isAuthOrScopeError(new Error('boom'))).toBe(false);
    expect(isAuthOrScopeError('boom')).toBe(false);
    expect(isAuthOrScopeError(undefined)).toBe(false);
  });
});
