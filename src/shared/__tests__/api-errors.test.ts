import * as http from 'http';
import type { AddressInfo } from 'net';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import axios from 'axios';
import { analytics } from '@utils/analytics';
import {
  diagnoseApiError,
  fetchProjectData,
  fetchUserData,
  handleApiError,
  retryTransient,
} from '../api';

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const url = 'https://us.posthog.com/api/projects/1/';
const config = { url, headers: new AxiosHeaders() };

function networkError(code: string, requestUrl = url): AxiosError {
  const requestConfig = { url: requestUrl, headers: new AxiosHeaders() };
  return new AxiosError('request failed', code, requestConfig, {});
}

const localUrl = 'http://localhost:8010/api/projects/1/';

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

  it('does not retry a local server that is not answering', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(networkError('ECONNREFUSED', localUrl));

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

  it('points at the local server instead of the network for localhost', () => {
    const error = handleApiError(
      networkError('ECONNREFUSED', localUrl),
      'fetch project data',
    );

    expect(error.message).toBe(
      "Couldn't reach localhost:8010 to fetch project data (ECONNREFUSED). Check that your local server is running.",
    );
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
    'advises IT and records the check when the system store trusts the chain: %s',
    async (systemStoreTrusts) => {
      const check = vi.fn().mockResolvedValue({
        issuer: 'Example Corp Root CA',
        systemStoreTrusts,
      });

      const error = await diagnoseApiError(
        certError,
        'fetch project data',
        check,
        () => false,
      );

      expect(check).toHaveBeenCalledWith('us.posthog.com', 443);
      expect(error.message).toContain('Ask your IT team');
      expect(error.message).not.toContain('use-system-ca');
      expect(error.message).not.toContain('Example Corp');
      expect(error.systemStoreTrusts).toBe(systemStoreTrusts);
    },
  );

  it('checks the request port on a host with one', async () => {
    const check = vi.fn().mockResolvedValue(null);

    await diagnoseApiError(
      networkError(
        'SELF_SIGNED_CERT_IN_CHAIN',
        'https://example.com:8443/api/',
      ),
      'fetch project data',
      check,
      () => false,
    );

    expect(check).toHaveBeenCalledWith('example.com', 8443);
  });

  it('skips the check when an https proxy is set', async () => {
    const check = vi.fn();

    const error = await diagnoseApiError(
      certError,
      'fetch project data',
      check,
      () => true,
    );

    expect(check).not.toHaveBeenCalled();
    expect(error.message).toContain('Ask your IT team');
    expect(error.systemStoreTrusts).toBeUndefined();
  });

  it('skips the check for a local server', async () => {
    const check = vi.fn();

    await diagnoseApiError(
      networkError('SELF_SIGNED_CERT_IN_CHAIN', 'https://localhost:8010/'),
      'fetch project data',
      check,
      () => false,
    );

    expect(check).not.toHaveBeenCalled();
  });

  it('skips the check for any other failure', async () => {
    const check = vi.fn();

    const error = await diagnoseApiError(
      networkError('ECONNRESET'),
      'fetch project data',
      check,
      () => false,
    );

    expect(check).not.toHaveBeenCalled();
    expect(error.message).toContain("Couldn't reach us.posthog.com");
  });
});

describe('fetchProjectData failure analytics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('captures the network code', async () => {
    // A local host isn't retried, so the test needs no timers.
    vi.spyOn(axios, 'get').mockRejectedValue(
      networkError('ECONNREFUSED', localUrl),
    );

    await expect(
      fetchProjectData('token', 1, 'http://localhost:8010'),
    ).rejects.toThrow('ECONNREFUSED');

    expect(analytics.captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        network_code: 'ECONNREFUSED',
        status_code: undefined,
      }),
    );
  });

  it('captures the status code', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(httpError(403));

    await expect(
      fetchProjectData('token', 1, 'https://us.posthog.com'),
    ).rejects.toThrow('Access denied');

    expect(analytics.captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status_code: 403, network_code: undefined }),
    );
  });
});

describe.concurrent('fetchUserData with a deadline', () => {
  const DEADLINE_MS = 3_000;
  // Remote hosts are reached through a local HTTP proxy, so their failures count as transient and retry.
  function answer(host: string, attempt: number, res: http.ServerResponse) {
    switch (host) {
      case 'fails-then-stalls.test':
        if (attempt === 1) res.writeHead(503).end();
        return;
    }
  }
  const requests = new Map<string, number>();
  let proxy: http.Server;
  let silentServer: http.Server;

  beforeAll(async () => {
    silentServer = http.createServer(() => undefined);
    await new Promise<void>((resolve) =>
      silentServer.listen(0, '127.0.0.1', resolve),
    );
    proxy = http.createServer((req, res) => {
      const host = req.headers.host ?? '';
      const attempt = (requests.get(host) ?? 0) + 1;
      requests.set(host, attempt);
      answer(host, attempt, res);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${
      (proxy.address() as AddressInfo).port
    }`;
    for (const name of ['npm_config_http_proxy', 'http_proxy', 'HTTP_PROXY']) {
      vi.stubEnv(name, proxyUrl);
    }
    for (const name of ['npm_config_no_proxy', 'no_proxy', 'NO_PROXY']) {
      vi.stubEnv(name, '127.0.0.1');
    }
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const server of [proxy, silentServer]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('gives up on a local server that accepts the request and never answers', async ({
    expect,
  }) => {
    const { port } = silentServer.address() as AddressInfo;

    await expect(
      fetchUserData(
        'token',
        `http://127.0.0.1:${port}`,
        AbortSignal.timeout(DEADLINE_MS),
      ),
    ).rejects.toThrow();
  });

  it('gives up after one deadline, retries included', async ({ expect }) => {
    const started = Date.now();

    await expect(
      fetchUserData(
        'token',
        'http://fails-then-stalls.test',
        AbortSignal.timeout(DEADLINE_MS),
      ),
    ).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(DEADLINE_MS + 400);
    expect(requests.get('fails-then-stalls.test')).toBe(2);
  });
});
