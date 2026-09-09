import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AWS_SKILLS_BASE_URL,
  GITHUB_SKILLS_BASE_URL,
  LOCAL_SKILLS_BASE_URL,
} from '@lib/constants';
import { initLocalDev, resetLocalDev } from '@lib/local-dev';
import {
  checkLlmGatewayHealth,
  checkSkillsOriginHealth,
  fetchEndpointHealth,
} from '../endpoints';
import { ServiceHealthStatus } from '../types';

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({ analytics: { wizardCapture: vi.fn() } }));

const fetchMock = vi.fn<typeof fetch>();
const primaryMenu = `${GITHUB_SKILLS_BASE_URL}/skill-menu.json`;
const fallbackMenu = `${AWS_SKILLS_BASE_URL}/skill-menu.json`;
const validMenu = {
  categories: {
    integration: [
      {
        id: 'posthog-integration',
        name: 'Install PostHog',
        downloadUrl: 'posthog-integration.zip',
      },
    ],
  },
};
const menuResponse = () => new Response(JSON.stringify(validMenu));
const httpResponse = (status: number) => new Response(null, { status });

async function finish<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetLocalDev();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetLocalDev();
});

describe('fetchEndpointHealth', () => {
  it('retries a transient HTTP error and recovers', async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(503))
      .mockResolvedValueOnce(httpResponse(200));

    const result = await finish(fetchEndpointHealth('https://example.com'));

    expect(result).toEqual({
      status: ServiceHealthStatus.Healthy,
      rawIndicator: 'HTTP 200 (attempts=2)',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains HTTP failure evidence when later attempts lose connection', async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(503))
      .mockRejectedValue(new Error('Connection reset'));

    expect(await finish(fetchEndpointHealth('https://example.com'))).toEqual({
      status: ServiceHealthStatus.Down,
      error: 'HTTP 503',
      rawIndicator: 'HTTP 503 (attempts=3)',
    });
  });

  it('keeps network-only failures distinct from confirmed downtime', async () => {
    fetchMock.mockRejectedValue(new Error('DNS lookup failed'));

    expect(await finish(fetchEndpointHealth('https://example.com'))).toEqual({
      status: ServiceHealthStatus.NoConnection,
      error: 'DNS lookup failed',
      rawIndicator: 'attempts=3',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('bounds hung requests and aborts every attempt', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));

    const result = await finish(
      fetchEndpointHealth('https://example.com', 100),
    );

    expect(result.status).toBe(ServiceHealthStatus.NoConnection);
    expect(result.error).toBe('Request timed out after 100ms');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('checkLlmGatewayHealth', () => {
  it.each([
    [
      'https://ai-gateway.eu.posthog.com',
      'https://ai-gateway.eu.posthog.com/readyz',
    ],
    ['http://localhost:8080/', 'http://localhost:8080/readyz'],
    ['https://gateway.example.com/v1', 'https://gateway.example.com/readyz'],
  ])(
    'probes the origin readiness endpoint for %s without a bearer',
    async (base, expected) => {
      fetchMock.mockResolvedValue(httpResponse(200));

      expect((await checkLlmGatewayHealth(base)).status).toBe(
        ServiceHealthStatus.Healthy,
      );
      expect(fetchMock).toHaveBeenCalledWith(expected, {
        signal: expect.any(AbortSignal),
        redirect: 'follow',
      });
    },
  );
});

describe('checkSkillsOriginHealth', () => {
  it.each([primaryMenu, fallbackMenu])(
    'stays healthy when only %s serves a usable menu',
    async (healthyUrl) => {
      fetchMock.mockImplementation((url) =>
        Promise.resolve(
          url === healthyUrl ? menuResponse() : httpResponse(503),
        ),
      );

      const pending = checkSkillsOriginHealth();
      // Both origin requests start before either retry loop waits.
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        primaryMenu,
        fallbackMenu,
      ]);
      const result = await finish(pending);

      expect(result).toEqual({
        status: ServiceHealthStatus.Healthy,
        rawIndicator: 'HTTP 200',
      });
      expect(result.error).toBeUndefined();
      expect(result.rawIndicator).not.toMatch(/unavailable|degraded/i);
    },
  );

  it('reports downtime only after both sources fail', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(httpResponse(503)));

    const result = await finish(checkSkillsOriginHealth());

    expect(result.status).toBe(ServiceHealthStatus.Down);
    expect(result.error).toBe('Both skill download sources are unavailable');
    expect(result.rawIndicator).toContain('attempts=3');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('reports no connection when neither origin can be reached', async () => {
    fetchMock.mockRejectedValue(new Error('Offline'));

    expect((await finish(checkSkillsOriginHealth())).status).toBe(
      ServiceHealthStatus.NoConnection,
    );
  });

  it('maps pinned releases to the same AWS release', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(menuResponse()));

    await checkSkillsOriginHealth(
      'https://github.com/PostHog/context-mill/releases/download/v1.2.3',
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://github.com/PostHog/context-mill/releases/download/v1.2.3/skill-menu.json',
      'https://context-mill.posthog.com/v1.2.3/skill-menu.json',
    ]);
  });

  it.each([
    '<html>GitHub temporarily unavailable</html>',
    JSON.stringify({ status: 'ok' }),
    JSON.stringify({ categories: {} }),
    JSON.stringify({ categories: { integration: [{ id: 'incomplete' }] } }),
    JSON.stringify({ categories: { integration: 'not an array' } }),
  ])('rejects unusable HTTP 200 skill menus: %s', async (body) => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(body)));

    expect((await finish(checkSkillsOriginHealth())).status).toBe(
      ServiceHealthStatus.Down,
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('uses the mirror when the primary HTTP 200 contains invalid JSON', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url === primaryMenu ? new Response('not JSON') : menuResponse(),
      ),
    );

    expect((await finish(checkSkillsOriginHealth())).status).toBe(
      ServiceHealthStatus.Healthy,
    );
  });

  it('retries failures while reading a successful response body', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.reject(new Error('Body stream interrupted')),
      } as unknown as Response),
    );

    const result = await finish(checkSkillsOriginHealth(LOCAL_SKILLS_BASE_URL));

    expect(result.status).toBe(ServiceHealthStatus.Down);
    expect(result.error).toBe('Body stream interrupted');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the timeout active until the skill menu body finishes', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        status: 200,
        json: () => new Promise(() => undefined),
      } as unknown as Response),
    );

    const result = await finish(checkSkillsOriginHealth(LOCAL_SKILLS_BASE_URL));

    expect(result.status).toBe(ServiceHealthStatus.Down);
    expect(result.error).toBe('Request timed out after 5000ms');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors the local context-mill target without probing production', async () => {
    initLocalDev({ localContextMill: true });
    fetchMock.mockImplementation(() => Promise.resolve(httpResponse(503)));

    expect((await finish(checkSkillsOriginHealth())).status).toBe(
      ServiceHealthStatus.Down,
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
      Array(3).fill(`${LOCAL_SKILLS_BASE_URL}/skill-menu.json`),
    );
  });

  it('downloads a menu from the configured custom target', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(menuResponse()));

    expect(
      (await checkSkillsOriginHealth('http://localhost:9000/custom/')).status,
    ).toBe(ServiceHealthStatus.Healthy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:9000/custom/skill-menu.json',
    );
  });
});
