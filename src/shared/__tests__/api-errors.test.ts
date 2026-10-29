import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { handleApiError } from '../api';

const url = 'https://us.posthog.com/api/projects/1/';
const config = { url, headers: new AxiosHeaders() };

function networkError(code: string): AxiosError {
  return new AxiosError('request failed', code, config, {});
}

describe('handleApiError', () => {
  it('names TLS inspection when the chain is untrusted', () => {
    const error = handleApiError(
      networkError('SELF_SIGNED_CERT_IN_CHAIN'),
      'fetch project data',
    );

    expect(error.message).toContain('intercepting HTTPS to us.posthog.com');
    expect(error.message).toContain('(SELF_SIGNED_CERT_IN_CHAIN)');
    expect(error.code).toBe('SELF_SIGNED_CERT_IN_CHAIN');
  });

  it('names the host and code when nothing answers', () => {
    const error = handleApiError(
      networkError('ECONNRESET'),
      'fetch project data',
    );

    expect(error.message).toBe(
      "Couldn't reach us.posthog.com to fetch project data (ECONNRESET). A VPN, proxy, firewall or security tool may be blocking it. Allow *.posthog.com, then run the wizard again.",
    );
    expect(error.code).toBe('ECONNRESET');
  });

  it('includes the status when the server sent no detail', () => {
    const response = { status: 502, data: {}, config } as AxiosResponse;
    const error = handleApiError(
      new AxiosError('bad gateway', 'ERR_BAD_RESPONSE', config, {}, response),
      'fetch project data',
    );

    expect(error.message).toBe('Failed to fetch project data (HTTP 502)');
    expect(error.statusCode).toBe(502);
  });
});
