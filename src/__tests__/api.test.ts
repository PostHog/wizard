import { AxiosError, AxiosHeaders } from 'axios';

import { isMissingScopeError } from '@lib/api';

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

describe('isMissingScopeError', () => {
  it('treats 401 as the benign missing-scope degradation', () => {
    expect(isMissingScopeError(axiosErrorWithStatus(401))).toBe(true);
  });

  it('treats 403 as the benign missing-scope degradation', () => {
    expect(isMissingScopeError(axiosErrorWithStatus(403))).toBe(true);
  });

  it('does not swallow other HTTP errors', () => {
    expect(isMissingScopeError(axiosErrorWithStatus(500))).toBe(false);
    expect(isMissingScopeError(axiosErrorWithStatus(404))).toBe(false);
  });

  it('does not treat non-axios errors as missing-scope', () => {
    expect(isMissingScopeError(new Error('boom'))).toBe(false);
    expect(isMissingScopeError('boom')).toBe(false);
    expect(isMissingScopeError(undefined)).toBe(false);
  });
});
