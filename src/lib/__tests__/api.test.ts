import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { z } from 'zod';
import { ApiError, handleApiError, isTransientNetworkError } from '@lib/api';

/**
 * Regression coverage for the Slack-connect poll noise: a transient connect
 * timeout used to surface a messageless `AggregateError` in error tracking
 * because `fetchSlackConnected` skipped `handleApiError`. These lock in that
 * transient connectivity failures (a) are recognised, (b) carry a real
 * message once routed through `handleApiError`, and (c) are flagged so the
 * poll can drop them, while genuine auth failures stay visible.
 */
function axiosNetworkError(code: string): AxiosError {
  const err = new AxiosError('', code);
  err.config = {
    url: '/api/projects/1/integrations/',
    headers: new AxiosHeaders(),
  };
  return err;
}

function axiosResponseError(status: number, detail?: string): AxiosError {
  const err = new AxiosError('Request failed');
  err.config = {
    url: '/api/projects/1/integrations/',
    headers: new AxiosHeaders(),
  };
  err.response = {
    status,
    statusText: '',
    data: detail ? { detail } : {},
    headers: {},
    config: err.config,
  };
  return err;
}

describe('isTransientNetworkError', () => {
  it('treats a messageless AggregateError (connect-timeout signature) as transient', () => {
    expect(isTransientNetworkError(new AggregateError([], ''))).toBe(true);
  });

  it('treats response-less axios connection errors as transient', () => {
    for (const code of [
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
    ]) {
      expect(isTransientNetworkError(axiosNetworkError(code))).toBe(true);
    }
  });

  it('does not treat an HTTP error response as transient', () => {
    expect(isTransientNetworkError(axiosResponseError(403))).toBe(false);
  });

  it('does not treat a Zod error or a plain error as transient', () => {
    expect(isTransientNetworkError(new z.ZodError([]))).toBe(false);
    expect(isTransientNetworkError(new Error('boom'))).toBe(false);
  });
});

describe('handleApiError', () => {
  it('gives a transient AggregateError a real message and flags it', () => {
    const apiError = handleApiError(
      new AggregateError([], ''),
      'check Slack integration',
    );
    expect(apiError).toBeInstanceOf(ApiError);
    expect(apiError.isTransient).toBe(true);
    expect(apiError.message).toContain('Network connection failed');
    expect(apiError.message).toContain('check Slack integration');
    // The whole point: no longer a messageless error.
    expect(apiError.message.length).toBeGreaterThan(0);
  });

  it('includes the axios error code for a response-less connection failure', () => {
    const apiError = handleApiError(
      axiosNetworkError('ETIMEDOUT'),
      'check Slack integration',
    );
    expect(apiError.isTransient).toBe(true);
    expect(apiError.message).toContain('ETIMEDOUT');
  });

  it('keeps genuine auth failures visible (not transient)', () => {
    const apiError = handleApiError(
      axiosResponseError(403),
      'check Slack integration',
    );
    expect(apiError.isTransient).toBe(false);
    expect(apiError.statusCode).toBe(403);
    expect(apiError.message).toContain('Access denied');
  });
});
