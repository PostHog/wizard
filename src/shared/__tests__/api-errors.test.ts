import axios, { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { analytics } from '@utils/analytics';
import { detectRegion } from '@utils/urls';
import { fetchProjectData, handleApiError } from '../api';

// Dev builds pin localhost, which skips the us/eu probe.
vi.mock(import('@shared/constants'), async (importOriginal) => ({
  ...(await importOriginal()),
  IS_DEV: false,
}));
vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const url = 'https://us.posthog.com/api/projects/1/';
const config = { url, headers: new AxiosHeaders() };

function networkError(code: string, requestUrl = url): AxiosError {
  const requestConfig = { url: requestUrl, headers: new AxiosHeaders() };
  return new AxiosError('request failed', code, requestConfig, {});
}

afterEach(() => vi.restoreAllMocks());

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

  it('points a local host at the local server', () => {
    const error = handleApiError(
      networkError('ECONNREFUSED', 'http://localhost:8010/api/projects/1/'),
      'fetch project data',
    );

    expect(error.message).toBe(
      "Couldn't reach localhost:8010 to fetch project data (ECONNREFUSED). Check that your local server is running.",
    );
  });
});

describe('login requests', () => {
  it('sends the cause code with the captured exception', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(networkError('ECONNRESET'));

    await expect(
      fetchProjectData('token', 1, 'https://us.posthog.com'),
    ).rejects.toThrow('(ECONNRESET)');
    expect(analytics.captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ error_code: 'ECONNRESET' }),
    );
  });

  it('names the network cause when no region answers', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(
      networkError('SELF_SIGNED_CERT_IN_CHAIN'),
    );

    await expect(detectRegion('token')).rejects.toThrow(
      'intercepting HTTPS to us.posthog.com',
    );
  });
});
