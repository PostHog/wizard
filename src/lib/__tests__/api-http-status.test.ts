import { AxiosError, AxiosHeaders } from 'axios';

import { httpStatusOf } from '@lib/api';

/**
 * `httpStatusOf` is what lets the SlackConnectScreen poll tell an expected
 * auth failure (401 expired token / 403 missing scope) apart from a real
 * exception, without pulling axios into the screen. These lock that in.
 */
describe('httpStatusOf', () => {
  const axiosErrorWithStatus = (status: number): AxiosError => {
    const err = new AxiosError('request failed');
    err.response = {
      status,
      statusText: '',
      headers: {},
      // config/data are unused by httpStatusOf; keep the shape minimal.
      config: { headers: new AxiosHeaders() },
      data: {},
    };
    return err;
  };

  it('returns the status code of an axios error with a response', () => {
    expect(httpStatusOf(axiosErrorWithStatus(401))).toBe(401);
    expect(httpStatusOf(axiosErrorWithStatus(403))).toBe(403);
    expect(httpStatusOf(axiosErrorWithStatus(500))).toBe(500);
  });

  it('returns undefined for an axios error with no response (network failure)', () => {
    expect(httpStatusOf(new AxiosError('network error'))).toBeUndefined();
  });

  it('returns undefined for non-axios errors', () => {
    expect(httpStatusOf(new Error('boom'))).toBeUndefined();
    expect(httpStatusOf('boom')).toBeUndefined();
    expect(httpStatusOf(undefined)).toBeUndefined();
  });
});
