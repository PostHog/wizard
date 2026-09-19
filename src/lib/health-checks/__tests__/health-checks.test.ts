import {
  checkAllExternalServices,
  checkSkillsOriginHealth,
  DEFAULT_WIZARD_READINESS_CONFIG,
  evaluateWizardReadiness,
  ServiceHealthStatus,
  WizardReadiness,
} from '@lib/health-checks/index';
import {
  checkLlmGatewayHealth,
  fetchEndpointHealth,
} from '@lib/health-checks/endpoints';
import { SIGNUP_WIZARD_READINESS_CONFIG } from '@lib/health-checks/readiness';

const URLS = {
  githubSkillMenu:
    'https://github.com/PostHog/context-mill/releases/latest/download/skill-menu.json',
  awsSkillMenu: 'https://context-mill.posthog.com/latest/skill-menu.json',
} as const;

const HEALTHY_RESPONSES: Record<string, { body: string; contentType: string }> =
  {
    [URLS.githubSkillMenu]: {
      body: JSON.stringify({ categories: { integration: [] } }),
      contentType: 'application/json',
    },
    [URLS.awsSkillMenu]: {
      body: JSON.stringify({ categories: { integration: [] } }),
      contentType: 'application/json',
    },
  };

function allHealthyFetchMock(url: string | URL | Request): Promise<Response> {
  const urlStr =
    typeof url === 'string'
      ? url
      : url instanceof URL
      ? url.toString()
      : url.url;
  const entry = HEALTHY_RESPONSES[urlStr];
  if (entry) {
    return Promise.resolve(
      new Response(entry.body, {
        status: 200,
        headers: { 'Content-Type': entry.contentType },
      }),
    );
  }
  return Promise.resolve(new Response('Not found', { status: 404 }));
}

function overrideFetch(overrides: Record<string, () => Promise<Response>>) {
  return (url: string | URL | Request): Promise<Response> => {
    const urlStr =
      typeof url === 'string'
        ? url
        : url instanceof URL
        ? url.toString()
        : url.url;
    if (overrides[urlStr]) return overrides[urlStr]();
    return allHealthyFetchMock(urlStr);
  };
}

describe('health-checks', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    (global as any).fetch = vi.fn(allHealthyFetchMock);
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  describe('fetchEndpointHealth', () => {
    const PROBE_URL = 'https://probe.posthog.test/_liveness';

    it('returns healthy on a 200', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () =>
            Promise.resolve(new Response('ok', { status: 200 })),
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toBe('HTTP 200');
      expect(global.fetch).toHaveBeenCalledWith(
        PROBE_URL,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns down on 302 — the default predicate stays strict, redirects are not OK', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () =>
            Promise.resolve(new Response(null, { status: 302 })),
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toContain('HTTP 302');
    });

    it('returns down when the endpoint responds 503 (e.g. deploying)', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () =>
            Promise.resolve(
              new Response('Service Unavailable', { status: 503 }),
            ),
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toContain('HTTP 503');
    });

    it('returns down when the endpoint responds 502 (bad gateway)', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () =>
            Promise.resolve(new Response('Bad Gateway', { status: 502 })),
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toContain('HTTP 502');
    });

    it('returns no-connection on DNS resolution failure (no status-page corroboration)', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () =>
            Promise.reject(
              new Error('getaddrinfo ENOTFOUND probe.posthog.test'),
            ),
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.NoConnection);
      expect(result.error).toBe('getaddrinfo ENOTFOUND probe.posthog.test');
    });

    it('returns no-connection on timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () => Promise.reject(abortError),
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.NoConnection);
      expect(result.error).toBe('Request timed out after 5000ms');
    });

    it('retries on network errors and recovers if a later attempt succeeds', async () => {
      let calls = 0;
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () => {
            calls++;
            if (calls < 3) {
              return Promise.reject(new Error('ECONNRESET'));
            }
            return Promise.resolve(new Response('ok', { status: 200 }));
          },
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toContain('attempts=3');
      expect(calls).toBe(3);
    });

    it('retries on persistent HTTP errors and stays Down after all attempts fail', async () => {
      let calls = 0;
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () => {
            calls++;
            return Promise.resolve(
              new Response('Service Unavailable', { status: 503 }),
            );
          },
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(calls).toBe(3);
      expect(result.error).toContain('HTTP 503');
      expect(result.error).toContain('attempts=3');
    });

    it('retries on transient 5xx and recovers if a later attempt succeeds', async () => {
      let calls = 0;
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () => {
            calls++;
            if (calls < 3) {
              return Promise.resolve(
                new Response('Bad Gateway', { status: 502 }),
              );
            }
            return Promise.resolve(new Response('ok', { status: 200 }));
          },
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toContain('attempts=3');
      expect(calls).toBe(3);
    });

    it('returns Down (not NoConnection) when last attempt got an HTTP response after earlier network errors', async () => {
      let calls = 0;
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [PROBE_URL]: () => {
            calls++;
            if (calls < 3) return Promise.reject(new Error('ECONNRESET'));
            return Promise.resolve(
              new Response('Bad Gateway', { status: 502 }),
            );
          },
        }),
      );
      const result = await fetchEndpointHealth(PROBE_URL);
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toContain('HTTP 502');
    });
  });

  it.each([
    'https://ai-gateway.us.posthog.com',
    'https://ai-gateway.eu.posthog.com/',
    'http://localhost:8789/v1',
  ])(
    'checks readiness on the minted gateway %s without credentials',
    async (gatewayUrl) => {
      (global.fetch as Mock).mockResolvedValue(
        new Response(null, { status: 200 }),
      );
      const result = await checkLlmGatewayHealth(gatewayUrl);
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(global.fetch).toHaveBeenCalledWith(
        new URL('/readyz', gatewayUrl).href,
        {
          signal: expect.any(AbortSignal),
          redirect: 'follow',
        },
      );
    },
  );

  describe('checkSkillsOriginHealth', () => {
    it('returns healthy on a final 200 and follows redirects (GitHub 302s asset URLs even for missing assets)', async () => {
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toBe('HTTP 200');
      expect(global.fetch).toHaveBeenCalledWith(
        URLS.githubSkillMenu,
        expect.objectContaining({ redirect: 'follow' }),
      );
    });

    it('probes both origins', async () => {
      await checkSkillsOriginHealth();
      const calledUrls = (global.fetch as Mock).mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(calledUrls).toContain(URLS.githubSkillMenu);
      expect(calledUrls).toContain(URLS.awsSkillMenu);
    });

    it('stays healthy when GitHub 5xxs but AWS serves the menu', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [URLS.githubSkillMenu]: () =>
            Promise.resolve(new Response('Bad Gateway', { status: 502 })),
        }),
      );
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toContain('github unavailable');
    });

    it('stays healthy when GitHub is unreachable but AWS serves the menu', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [URLS.githubSkillMenu]: () =>
            Promise.reject(new Error('ENOTFOUND github.com')),
        }),
      );
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toContain('github unavailable');
    });

    it('stays healthy when GitHub 404s but AWS serves the menu', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [URLS.githubSkillMenu]: () =>
            Promise.resolve(new Response('Not Found', { status: 404 })),
        }),
      );
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toContain('github unavailable');
    });

    it('stays healthy when AWS is unreachable but GitHub serves the menu', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [URLS.awsSkillMenu]: () => Promise.reject(new Error('fetch failed')),
        }),
      );
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toContain('aws unavailable');
    });

    it('returns down only when both origins 404 (release published without the asset)', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [URLS.githubSkillMenu]: () =>
            Promise.resolve(new Response('Not Found', { status: 404 })),
          [URLS.awsSkillMenu]: () =>
            Promise.resolve(new Response('Not Found', { status: 404 })),
        }),
      );
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toContain('github: HTTP 404');
      expect(result.error).toContain('aws: HTTP 404');
    });

    it('returns no-connection when both origins fail at the network layer', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [URLS.githubSkillMenu]: () =>
            Promise.reject(new Error('ENOTFOUND github.com')),
          [URLS.awsSkillMenu]: () => Promise.reject(new Error('ECONNRESET')),
        }),
      );
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.NoConnection);
      expect(result.error).toContain('ENOTFOUND github.com');
      expect(result.error).toContain('ECONNRESET');
    });

    it('reports down when GitHub 5xxs and AWS is unreachable', async () => {
      (global.fetch as Mock).mockImplementation(
        overrideFetch({
          [URLS.githubSkillMenu]: () =>
            Promise.resolve(new Response('Bad Gateway', { status: 502 })),
          [URLS.awsSkillMenu]: () => Promise.reject(new Error('ECONNRESET')),
        }),
      );
      const result = await checkSkillsOriginHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
    });
  });

  describe('checkAllExternalServices', () => {
    it('returns skills health and only probes the two download origins', async () => {
      const health = await checkAllExternalServices();
      expect(health).toEqual({
        skillsOrigin: {
          status: ServiceHealthStatus.Healthy,
          rawIndicator: 'HTTP 200',
        },
      });
      const calledUrls = (global.fetch as Mock).mock.calls.map(
        (call: unknown[]) => call[0],
      );
      expect(calledUrls).toEqual([URLS.githubSkillMenu, URLS.awsSkillMenu]);
    });
  });

  describe('evaluateWizardReadiness', () => {
    it('returns Yes when all services are healthy', async () => {
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.Yes);
    });

    it.each([
      [true, true, WizardReadiness.Yes],
      [false, true, WizardReadiness.Yes],
      [true, false, WizardReadiness.Yes],
      [false, false, WizardReadiness.No],
    ])(
      'skills availability: GitHub=%s AWS=%s yields %s',
      async (github, aws, decision) => {
        (global.fetch as Mock).mockImplementation((url: string | URL) => {
          const healthy =
            (url.toString() === URLS.githubSkillMenu && github) ||
            (url.toString() === URLS.awsSkillMenu && aws);
          return Promise.resolve(
            new Response(null, { status: healthy ? 200 : 503 }),
          );
        });
        const results = await Promise.all([
          evaluateWizardReadiness(),
          evaluateWizardReadiness(SIGNUP_WIZARD_READINESS_CONFIG),
        ]);
        for (const result of results) {
          expect(result.decision).toBe(decision);
          expect(result.reasons).toHaveLength(
            decision === WizardReadiness.No ? 1 : 0,
          );
          if (decision === WizardReadiness.No) {
            expect(result.reasons[0]).toContain('Skills download');
          }
        }
      },
    );
  });
});
