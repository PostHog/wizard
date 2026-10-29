import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { diagnoseApiError, handleApiError, retryTransient } from '../api';

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

const url = 'https://us.posthog.com/api/projects/1/';
const config = { url, headers: new AxiosHeaders() };

function networkError(code: string): AxiosError {
  return new AxiosError('request failed', code, config, {});
}

function httpError(status: number): AxiosError {
  const response = { status, data: {}, config } as AxiosResponse;
  return new AxiosError(
    'request failed',
    'ERR_BAD_RESPONSE',
    config,
    {},
    response,
  );
}

describe('retryTransient', () => {
  const sleep = vi.fn(() => Promise.resolve());

  beforeEach(() => sleep.mockClear());

  it('retries a network error until the request succeeds', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(networkError('ECONNRESET'))
      .mockRejectedValueOnce(httpError(502))
      .mockResolvedValue('ok');

    await expect(retryTransient(request, sleep)).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts', async () => {
    const request = vi.fn().mockRejectedValue(httpError(503));

    await expect(retryTransient(request, sleep)).rejects.toBeInstanceOf(
      AxiosError,
    );
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not retry a status a retry cannot fix', async () => {
    const request = vi.fn().mockRejectedValue(httpError(403));

    await expect(retryTransient(request, sleep)).rejects.toBeInstanceOf(
      AxiosError,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry an untrusted certificate', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(networkError('SELF_SIGNED_CERT_IN_CHAIN'));

    await expect(retryTransient(request, sleep)).rejects.toBeInstanceOf(
      AxiosError,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('handleApiError', () => {
  it('names the host and code when no response came back', () => {
    const error = handleApiError(
      networkError('ECONNRESET'),
      'fetch project data',
    );

    expect(error.message).toContain(
      "Couldn't reach us.posthog.com to fetch project data (ECONNRESET)",
    );
    expect(error.statusCode).toBeUndefined();
  });

  it('points at TLS inspection for an untrusted certificate', () => {
    const error = handleApiError(
      networkError('SELF_SIGNED_CERT_IN_CHAIN'),
      'fetch project data',
    );

    expect(error.message).toContain('intercepting HTTPS');
    expect(error.message).toContain('SELF_SIGNED_CERT_IN_CHAIN');
  });

  it('includes the status of an unexpected response', () => {
    const error = handleApiError(httpError(502), 'fetch project data');

    expect(error.message).toBe('Failed to fetch project data (HTTP 502)');
    expect(error.statusCode).toBe(502);
  });
});

describe('diagnoseApiError', () => {
  const certError = networkError('SELF_SIGNED_CERT_IN_CHAIN');

  it.each([true, false])(
    'advises IT and records the probe when the system store trusts the chain: %s',
    async (systemStoreTrusts) => {
      const probe = vi.fn().mockResolvedValue({
        issuer: 'Example Corp Root CA',
        systemStoreTrusts,
      });

      const error = await diagnoseApiError(
        certError,
        'fetch project data',
        probe,
      );

      expect(probe).toHaveBeenCalledWith('us.posthog.com');
      expect(error.message).toContain('Ask your IT team');
      expect(error.message).not.toContain('use-system-ca');
      expect(error.message).not.toContain('Example Corp');
      expect(error.systemStoreTrusts).toBe(systemStoreTrusts);
    },
  );

  it('skips the probe for any other failure', async () => {
    const probe = vi.fn();

    const error = await diagnoseApiError(
      networkError('ECONNRESET'),
      'fetch project data',
      probe,
    );

    expect(probe).not.toHaveBeenCalled();
    expect(error.message).toContain("Couldn't reach us.posthog.com");
  });
});
