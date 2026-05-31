import { AxiosError, AxiosHeaders } from 'axios';
import { getOAuthErrorDetails } from '@utils/oauth';

function makeAxiosError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    {},
    {
      status,
      statusText: '',
      headers: {},
      config,
      data,
    },
  );
}

describe('getOAuthErrorDetails', () => {
  it('extracts error and description from an OAuth error body', () => {
    const error = makeAxiosError(400, {
      error: 'invalid_grant',
      error_description: 'The authorization code has expired',
    });

    expect(getOAuthErrorDetails(error)).toEqual({
      error: 'invalid_grant',
      description: 'The authorization code has expired',
    });
  });

  it('extracts error when description is absent', () => {
    const error = makeAxiosError(400, { error: 'invalid_grant' });

    expect(getOAuthErrorDetails(error)).toEqual({
      error: 'invalid_grant',
      description: undefined,
    });
  });

  it('returns null for an axios error without an OAuth body', () => {
    expect(
      getOAuthErrorDetails(makeAxiosError(500, 'Internal Server Error')),
    ).toBeNull();
    expect(
      getOAuthErrorDetails(makeAxiosError(400, { foo: 'bar' })),
    ).toBeNull();
    expect(getOAuthErrorDetails(makeAxiosError(400, null))).toBeNull();
  });

  it('returns null for non-axios errors', () => {
    expect(getOAuthErrorDetails(new Error('boom'))).toBeNull();
    expect(getOAuthErrorDetails('boom')).toBeNull();
    expect(getOAuthErrorDetails(undefined)).toBeNull();
  });
});
