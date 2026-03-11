/**
 * Tests for health-checks.ts
 *
 * Mock data is modelled on live Statuspage.io v2 API responses.
 * Statuspage docs: https://metastatuspage.com/api
 *
 * status.json  – page-level rollup with indicator (none | minor | major | critical)
 * summary.json – same rollup plus component list; component statuses:
 *   operational | degraded_performance | partial_outage | major_outage | under_maintenance
 *   https://support.atlassian.com/statuspage/docs/show-service-status-with-components
 *
 * LLM Gateway – FastAPI service, GET /_liveness returns {"status":"alive"} (200)
 *   Source: posthog/services/llm-gateway/src/llm_gateway/api/health.py
 *
 * MCP – Cloudflare Worker, GET / returns an HTML landing page (200)
 *   Source: posthog/services/mcp/src/index.ts
 */

import {
  checkAllExternalServices,
  checkAnthropicHealth,
  checkCloudflareComponentHealth,
  checkCloudflareOverallHealth,
  checkGithubHealth,
  checkLlmGatewayHealth,
  checkMcpHealth,
  checkNpmComponentHealth,
  checkNpmOverallHealth,
  checkPosthogComponentHealth,
  checkPosthogOverallHealth,
  DEFAULT_WIZARD_READINESS_CONFIG,
  evaluateWizardReadiness,
  ServiceHealthStatus,
  WizardReadiness,
} from '../index';

// ---------------------------------------------------------------------------
// Real-world Statuspage.io v2 response factories
// https://metastatuspage.com/api
// ---------------------------------------------------------------------------

function makeStatuspageStatus(opts: {
  pageId: string;
  pageName: string;
  pageUrl: string;
  indicator: 'none' | 'minor' | 'major' | 'critical';
  description: string;
}) {
  return {
    page: {
      id: opts.pageId,
      name: opts.pageName,
      url: opts.pageUrl,
      time_zone: 'Etc/UTC',
      updated_at: '2026-03-05T16:03:38.861Z',
    },
    status: {
      indicator: opts.indicator,
      description: opts.description,
    },
  };
}

function makeStatuspageSummary(opts: {
  pageId: string;
  pageName: string;
  pageUrl: string;
  indicator: 'none' | 'minor' | 'major' | 'critical';
  description: string;
  components: {
    id: string;
    name: string;
    status: string;
    position: number;
    description: string | null;
  }[];
}) {
  return {
    page: {
      id: opts.pageId,
      name: opts.pageName,
      url: opts.pageUrl,
      time_zone: 'Etc/UTC',
      updated_at: '2026-03-05T16:03:38.861Z',
    },
    status: {
      indicator: opts.indicator,
      description: opts.description,
    },
    components: opts.components.map((c) => ({
      ...c,
      page_id: opts.pageId,
      created_at: '2023-07-11T17:52:24.275Z',
      updated_at: '2026-03-04T17:01:29.960Z',
      showcase: true,
      start_date: '2023-07-11',
      group_id: null,
      group: false,
      only_show_if_degraded: false,
    })),
    incidents: [],
    scheduled_maintenances: [],
  };
}

// Shapes taken from live GET on 2026-03-05
const ANTHROPIC_STATUS_HEALTHY = makeStatuspageStatus({
  pageId: 'tymt9n04zgry',
  pageName: 'Claude',
  pageUrl: 'https://status.claude.com',
  indicator: 'none',
  description: 'All Systems Operational',
});

const GITHUB_STATUS_HEALTHY = makeStatuspageStatus({
  pageId: 'kctbh9vrtdwd',
  pageName: 'GitHub',
  pageUrl: 'https://www.githubstatus.com',
  indicator: 'none',
  description: 'All Systems Operational',
});

const NPM_STATUS_HEALTHY = makeStatuspageStatus({
  pageId: 'wyvgptkd90hm',
  pageName: 'npm',
  pageUrl: 'https://status.npmjs.org',
  indicator: 'none',
  description: 'All Systems Operational',
});

const NPM_SUMMARY_HEALTHY = makeStatuspageSummary({
  pageId: 'wyvgptkd90hm',
  pageName: 'npm',
  pageUrl: 'https://status.npmjs.org',
  indicator: 'none',
  description: 'All Systems Operational',
  components: [
    {
      id: 'mvm98gtxvb9b',
      name: 'www.npmjs.com website',
      status: 'operational',
      position: 1,
      description:
        'The ability for users to navigate to or interact with the npm website.',
    },
    {
      id: 'k1wj10x6gmph',
      name: 'Package installation',
      status: 'operational',
      position: 2,
      description:
        'The ability for users to read from the registry so that they can install packages.',
    },
  ],
});

const CLOUDFLARE_STATUS_HEALTHY = makeStatuspageStatus({
  pageId: 'yh6f0r4529hb',
  pageName: 'Cloudflare',
  pageUrl: 'https://www.cloudflarestatus.com',
  indicator: 'none',
  description: 'All Systems Operational',
});

const CLOUDFLARE_SUMMARY_HEALTHY = makeStatuspageSummary({
  pageId: 'yh6f0r4529hb',
  pageName: 'Cloudflare',
  pageUrl: 'https://www.cloudflarestatus.com',
  indicator: 'none',
  description: 'All Systems Operational',
  components: [
    {
      id: '1km35smx8p41',
      name: 'Cloudflare Sites and Services',
      status: 'operational',
      position: 1,
      description:
        'Sites and services that Cloudflare customers use to interact with the Cloudflare Network',
    },
  ],
});

const POSTHOG_STATUS_HEALTHY = makeStatuspageStatus({
  pageId: 'qf5jlnph3bcy',
  pageName: 'PostHog',
  pageUrl: 'https://status.posthog.com',
  indicator: 'none',
  description: 'All Systems Operational',
});

const POSTHOG_SUMMARY_HEALTHY = makeStatuspageSummary({
  pageId: 'qf5jlnph3bcy',
  pageName: 'PostHog',
  pageUrl: 'https://status.posthog.com',
  indicator: 'none',
  description: 'All Systems Operational',
  components: [
    {
      id: 'us-cloud',
      name: 'US Cloud',
      status: 'operational',
      position: 1,
      description: null,
    },
    {
      id: 'eu-cloud',
      name: 'EU Cloud',
      status: 'operational',
      position: 2,
      description: null,
    },
    {
      id: 'posthog-com',
      name: 'PostHog.com',
      status: 'operational',
      position: 3,
      description: null,
    },
  ],
});

// LLM Gateway /_liveness response (from posthog/services/llm-gateway/src/llm_gateway/api/health.py)
const LLM_GATEWAY_LIVENESS_BODY = JSON.stringify({ status: 'alive' });

// MCP / landing page (from posthog/services/mcp/src/index.ts + src/static/landing.html)
const MCP_LANDING_HTML =
  '<!doctype html><html lang="en"><head><title>PostHog MCP Server</title></head><body></body></html>';

// ---------------------------------------------------------------------------
// URL constants (must match health-checks.ts)
// ---------------------------------------------------------------------------

const URLS = {
  anthropicStatus: 'https://status.claude.com/api/v2/status.json',
  posthogStatus: 'https://www.posthogstatus.com/api/v2/status.json',
  posthogSummary: 'https://www.posthogstatus.com/api/v2/summary.json',
  githubStatus: 'https://www.githubstatus.com/api/v2/status.json',
  npmStatus: 'https://status.npmjs.org/api/v2/status.json',
  npmSummary: 'https://status.npmjs.org/api/v2/summary.json',
  cloudflareStatus: 'https://www.cloudflarestatus.com/api/v2/status.json',
  cloudflareSummary: 'https://www.cloudflarestatus.com/api/v2/summary.json',
  llmGatewayLiveness: 'https://gateway.us.posthog.com/_liveness',
  mcpLanding: 'https://mcp.posthog.com/',
} as const;

// ---------------------------------------------------------------------------
// Helper to build a default "all healthy" fetch mock
// ---------------------------------------------------------------------------

const HEALTHY_RESPONSES: Record<string, { body: string; contentType: string }> =
  {
    [URLS.anthropicStatus]: {
      body: JSON.stringify(ANTHROPIC_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.posthogStatus]: {
      body: JSON.stringify(POSTHOG_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.posthogSummary]: {
      body: JSON.stringify(POSTHOG_SUMMARY_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.githubStatus]: {
      body: JSON.stringify(GITHUB_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.npmStatus]: {
      body: JSON.stringify(NPM_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.npmSummary]: {
      body: JSON.stringify(NPM_SUMMARY_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.cloudflareStatus]: {
      body: JSON.stringify(CLOUDFLARE_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.cloudflareSummary]: {
      body: JSON.stringify(CLOUDFLARE_SUMMARY_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.llmGatewayLiveness]: {
      body: LLM_GATEWAY_LIVENESS_BODY,
      contentType: 'application/json',
    },
    [URLS.mcpLanding]: {
      body: MCP_LANDING_HTML,
      contentType: 'text/html; charset=utf-8',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('health-checks', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = jest.fn(allHealthyFetchMock);
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Statuspage status.json checks (indicator-based)
  // -----------------------------------------------------------------------

  describe('checkAnthropicHealth', () => {
    it('returns healthy for indicator=none ("All Systems Operational")', async () => {
      const result = await checkAnthropicHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toBe('none');
    });

    it('returns degraded for indicator=minor ("Minor Service Outage")', async () => {
      const body = makeStatuspageStatus({
        pageId: 'tymt9n04zgry',
        pageName: 'Claude',
        pageUrl: 'https://status.claude.com',
        indicator: 'minor',
        description: 'Minor Service Outage',
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkAnthropicHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.rawIndicator).toBe('minor');
    });

    it('returns down for indicator=major ("Partial System Outage")', async () => {
      const body = makeStatuspageStatus({
        pageId: 'tymt9n04zgry',
        pageName: 'Claude',
        pageUrl: 'https://status.claude.com',
        indicator: 'major',
        description: 'Partial System Outage',
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkAnthropicHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
    });

    it('returns down for indicator=critical ("Major Service Outage")', async () => {
      const body = makeStatuspageStatus({
        pageId: 'tymt9n04zgry',
        pageName: 'Claude',
        pageUrl: 'https://status.claude.com',
        indicator: 'critical',
        description: 'Major Service Outage',
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkAnthropicHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
    });

    it('returns degraded when statuspage returns HTTP 500', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.resolve(
              new Response('Internal Server Error', { status: 500 }),
            ),
        }),
      );
      const result = await checkAnthropicHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.error).toBe('HTTP 500');
    });

    it('returns degraded when fetch throws (network failure)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.reject(
              new Error('getaddrinfo ENOTFOUND status.claude.com'),
            ),
        }),
      );
      const result = await checkAnthropicHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.error).toBe('getaddrinfo ENOTFOUND status.claude.com');
    });
  });

  describe('checkPosthogOverallHealth', () => {
    it('returns healthy for indicator=none', async () => {
      const result = await checkPosthogOverallHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toBe('none');
    });
  });

  describe('checkGithubHealth', () => {
    it('returns healthy for indicator=none', async () => {
      const result = await checkGithubHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
    });
  });

  describe('checkNpmOverallHealth', () => {
    it('returns healthy for indicator=none', async () => {
      const result = await checkNpmOverallHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
    });
  });

  describe('checkCloudflareOverallHealth', () => {
    it('returns healthy for indicator=none', async () => {
      const result = await checkCloudflareOverallHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
    });

    it('returns degraded for indicator=minor', async () => {
      const body = makeStatuspageStatus({
        pageId: 'yh6f0r4529hb',
        pageName: 'Cloudflare',
        pageUrl: 'https://www.cloudflarestatus.com',
        indicator: 'minor',
        description: 'Minor Service Outage',
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.cloudflareStatus]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkCloudflareOverallHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
    });
  });

  // -----------------------------------------------------------------------
  // Statuspage summary.json checks (component-based)
  // -----------------------------------------------------------------------

  describe('checkPosthogComponentHealth', () => {
    it('reports all operational when every component is operational', async () => {
      const result = await checkPosthogComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.degradedOrDownComponents).toBeUndefined();
    });

    it('reports degraded when a component has partial_outage', async () => {
      const body = makeStatuspageSummary({
        pageId: 'qf5jlnph3bcy',
        pageName: 'PostHog',
        pageUrl: 'https://status.posthog.com',
        indicator: 'major',
        description: 'Partial System Outage',
        components: [
          {
            id: 'us-cloud',
            name: 'US Cloud',
            status: 'partial_outage',
            position: 1,
            description: null,
          },
          {
            id: 'eu-cloud',
            name: 'EU Cloud',
            status: 'operational',
            position: 2,
            description: null,
          },
        ],
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.posthogSummary]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkPosthogComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.degradedOrDownComponents).toHaveLength(1);
      expect(result.degradedOrDownComponents![0].name).toBe('US Cloud');
      expect(result.degradedOrDownComponents![0].rawStatus).toBe(
        'partial_outage',
      );
      expect(result.degradedOrDownComponents![0].status).toBe(
        ServiceHealthStatus.Down,
      );
    });

    it('reports degraded when a component has degraded_performance', async () => {
      const body = makeStatuspageSummary({
        pageId: 'qf5jlnph3bcy',
        pageName: 'PostHog',
        pageUrl: 'https://status.posthog.com',
        indicator: 'minor',
        description: 'Degraded System Performance',
        components: [
          {
            id: 'us-cloud',
            name: 'US Cloud',
            status: 'degraded_performance',
            position: 1,
            description: null,
          },
          {
            id: 'eu-cloud',
            name: 'EU Cloud',
            status: 'operational',
            position: 2,
            description: null,
          },
        ],
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.posthogSummary]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkPosthogComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.degradedOrDownComponents![0].rawStatus).toBe(
        'degraded_performance',
      );
      expect(result.degradedOrDownComponents![0].status).toBe(
        ServiceHealthStatus.Degraded,
      );
    });

    it('reports degraded when a component has major_outage', async () => {
      const body = makeStatuspageSummary({
        pageId: 'qf5jlnph3bcy',
        pageName: 'PostHog',
        pageUrl: 'https://status.posthog.com',
        indicator: 'critical',
        description: 'Major Service Outage',
        components: [
          {
            id: 'us-cloud',
            name: 'US Cloud',
            status: 'major_outage',
            position: 1,
            description: null,
          },
          {
            id: 'eu-cloud',
            name: 'EU Cloud',
            status: 'major_outage',
            position: 2,
            description: null,
          },
        ],
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.posthogSummary]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkPosthogComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.degradedOrDownComponents).toHaveLength(2);
      expect(result.degradedOrDownComponents![0].status).toBe(
        ServiceHealthStatus.Down,
      );
    });

    it('handles under_maintenance as degraded', async () => {
      const body = makeStatuspageSummary({
        pageId: 'qf5jlnph3bcy',
        pageName: 'PostHog',
        pageUrl: 'https://status.posthog.com',
        indicator: 'minor',
        description: 'Scheduled Maintenance',
        components: [
          {
            id: 'us-cloud',
            name: 'US Cloud',
            status: 'under_maintenance',
            position: 1,
            description: null,
          },
        ],
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.posthogSummary]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkPosthogComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.degradedOrDownComponents![0].status).toBe(
        ServiceHealthStatus.Degraded,
      );
    });
  });

  describe('checkNpmComponentHealth', () => {
    it('reports healthy when all npm components operational', async () => {
      const result = await checkNpmComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
    });

    it('reports degraded when "Package installation" has partial_outage', async () => {
      const body = makeStatuspageSummary({
        pageId: 'wyvgptkd90hm',
        pageName: 'npm',
        pageUrl: 'https://status.npmjs.org',
        indicator: 'major',
        description: 'Partial System Outage',
        components: [
          {
            id: 'mvm98gtxvb9b',
            name: 'www.npmjs.com website',
            status: 'operational',
            position: 1,
            description: null,
          },
          {
            id: 'k1wj10x6gmph',
            name: 'Package installation',
            status: 'partial_outage',
            position: 2,
            description: null,
          },
        ],
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.npmSummary]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await checkNpmComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Degraded);
      expect(result.degradedOrDownComponents![0].name).toBe(
        'Package installation',
      );
    });
  });

  describe('checkCloudflareComponentHealth', () => {
    it('reports healthy when Cloudflare components operational', async () => {
      const result = await checkCloudflareComponentHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
    });
  });

  // -----------------------------------------------------------------------
  // LLM Gateway (fetchEndpointHealth – /_liveness)
  // -----------------------------------------------------------------------

  describe('checkLlmGatewayHealth', () => {
    it('returns healthy when gateway responds 200 with {"status":"alive"}', async () => {
      const result = await checkLlmGatewayHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toBe('HTTP 200');
      expect(global.fetch).toHaveBeenCalledWith(
        URLS.llmGatewayLiveness,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns down when gateway responds 503 (e.g. deploying)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.llmGatewayLiveness]: () =>
            Promise.resolve(
              new Response('Service Unavailable', { status: 503 }),
            ),
        }),
      );
      const result = await checkLlmGatewayHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toBe('HTTP 503');
    });

    it('returns down when gateway responds 502 (bad gateway)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.llmGatewayLiveness]: () =>
            Promise.resolve(new Response('Bad Gateway', { status: 502 })),
        }),
      );
      const result = await checkLlmGatewayHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toBe('HTTP 502');
    });

    it('returns down on DNS resolution failure', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.llmGatewayLiveness]: () =>
            Promise.reject(
              new Error('getaddrinfo ENOTFOUND gateway.us.posthog.com'),
            ),
        }),
      );
      const result = await checkLlmGatewayHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toBe('getaddrinfo ENOTFOUND gateway.us.posthog.com');
    });

    it('returns down on timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.llmGatewayLiveness]: () => Promise.reject(abortError),
        }),
      );
      const result = await checkLlmGatewayHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toBe('Request timed out');
    });
  });

  // -----------------------------------------------------------------------
  // MCP (fetchEndpointHealth – / landing)
  // -----------------------------------------------------------------------

  describe('checkMcpHealth', () => {
    it('returns healthy when MCP worker responds 200 with landing HTML', async () => {
      const result = await checkMcpHealth();
      expect(result.status).toBe(ServiceHealthStatus.Healthy);
      expect(result.rawIndicator).toBe('HTTP 200');
      expect(global.fetch).toHaveBeenCalledWith(
        URLS.mcpLanding,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns down when worker responds 500', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.mcpLanding]: () =>
            Promise.resolve(
              new Response('Internal Server Error', { status: 500 }),
            ),
        }),
      );
      const result = await checkMcpHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toBe('HTTP 500');
    });

    it('returns down when Cloudflare returns 522 (connection timed out)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.mcpLanding]: () =>
            Promise.resolve(new Response('', { status: 522 })),
        }),
      );
      const result = await checkMcpHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toBe('HTTP 522');
    });

    it('returns down on network failure', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.mcpLanding]: () => Promise.reject(new Error('fetch failed')),
        }),
      );
      const result = await checkMcpHealth();
      expect(result.status).toBe(ServiceHealthStatus.Down);
      expect(result.error).toBe('fetch failed');
    });
  });

  // -----------------------------------------------------------------------
  // checkAllExternalServices
  // -----------------------------------------------------------------------

  describe('checkAllExternalServices', () => {
    it('returns all 10 service keys when everything is healthy', async () => {
      const health = await checkAllExternalServices();
      const keys = Object.keys(health);
      expect(keys).toEqual(
        expect.arrayContaining([
          'anthropic',
          'posthogOverall',
          'posthogComponents',
          'github',
          'npmOverall',
          'npmComponents',
          'cloudflareOverall',
          'cloudflareComponents',
          'llmGateway',
          'mcp',
        ]),
      );
      expect(keys).toHaveLength(10);
      for (const val of Object.values(health)) {
        expect(val.status).toBe(ServiceHealthStatus.Healthy);
      }
    });

    it('fires all 10 fetch calls in parallel', async () => {
      await checkAllExternalServices();
      const calledUrls = (global.fetch as jest.Mock).mock.calls.map(
        (c: unknown[]) =>
          typeof c[0] === 'string' ? c[0] : (c[0] as URL).toString(),
      );
      expect(calledUrls).toHaveLength(10);
      expect(calledUrls).toContain(URLS.llmGatewayLiveness);
      expect(calledUrls).toContain(URLS.mcpLanding);
    });
  });

  // -----------------------------------------------------------------------
  // evaluateWizardReadiness
  // -----------------------------------------------------------------------

  describe('evaluateWizardReadiness', () => {
    it('returns Yes when all services are healthy', async () => {
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.Yes);
    });

    it('returns No when Anthropic is degraded (degradedBlocksRun)', async () => {
      const body = makeStatuspageStatus({
        pageId: 'tymt9n04zgry',
        pageName: 'Claude',
        pageUrl: 'https://status.claude.com',
        indicator: 'minor',
        description: 'Minor Service Outage',
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.No);
      expect(result.health.anthropic.status).toBe(ServiceHealthStatus.Degraded);
    });

    it('returns No when LLM Gateway is down (downBlocksRun)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.llmGatewayLiveness]: () =>
            Promise.resolve(
              new Response('Service Unavailable', { status: 503 }),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.No);
      expect(result.health.llmGateway.status).toBe(ServiceHealthStatus.Down);
    });

    it('returns No when MCP is down (downBlocksRun)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.mcpLanding]: () =>
            Promise.resolve(new Response('Bad Gateway', { status: 502 })),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.No);
      expect(result.health.mcp.status).toBe(ServiceHealthStatus.Down);
    });

    it('does not block when npm overall is down (no longer in downBlocksRun)', async () => {
      const body = makeStatuspageStatus({
        pageId: 'wyvgptkd90hm',
        pageName: 'npm',
        pageUrl: 'https://status.npmjs.org',
        indicator: 'critical',
        description: 'Major Service Outage',
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.npmStatus]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.health.npmOverall.status).toBe(ServiceHealthStatus.Down);
      expect(result.decision).toBe(WizardReadiness.YesWithWarnings);
    });

    it('returns YesWithWarnings when a non-blocking service is degraded', async () => {
      const body = makeStatuspageStatus({
        pageId: 'yh6f0r4529hb',
        pageName: 'Cloudflare',
        pageUrl: 'https://www.cloudflarestatus.com',
        indicator: 'minor',
        description: 'Minor Service Outage',
      });
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.cloudflareStatus]: () =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200 }),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.YesWithWarnings);
    });

    it('includes human-readable reasons for every service', async () => {
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('Anthropic'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('PostHog'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('GitHub'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('npm'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('Cloudflare'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('LLM Gateway'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('MCP'))).toBe(true);
    });
  });
});
