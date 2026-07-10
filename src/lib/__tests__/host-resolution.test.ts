import { describe, it, expect } from 'vitest';
import {
  HostResolution,
  mcpModeFromUrl,
  mcpUrlFor,
} from '@lib/host-resolution';

/**
 * Contract test for HostResolution — the durable record of what the host family
 * guarantees. `fromApiHost` is environment-independent (it never consults
 * IS_DEV), so it locks down the prod region→host mapping even though the test
 * runner sets NODE_ENV=test (which makes `fromRegion` resolve to localhost).
 */
describe('HostResolution.fromApiHost', () => {
  it('derives the full US host family from the US ingestion host', () => {
    const h = HostResolution.fromApiHost('https://us.i.posthog.com');
    expect(h.region).toBe('us');
    expect(h.apiHost).toBe('https://us.i.posthog.com');
    expect(h.appHost).toBe('https://us.posthog.com');
    expect(h.assetHost).toBe('https://us-assets.i.posthog.com');
    expect(h.gatewayUrl).toBe('https://gateway.us.posthog.com/wizard');
  });

  it('derives the full EU host family from the EU ingestion host', () => {
    const h = HostResolution.fromApiHost('https://eu.i.posthog.com');
    expect(h.region).toBe('eu');
    expect(h.apiHost).toBe('https://eu.i.posthog.com');
    expect(h.appHost).toBe('https://eu.posthog.com');
    expect(h.assetHost).toBe('https://eu-assets.i.posthog.com');
    expect(h.gatewayUrl).toBe('https://gateway.eu.posthog.com/wizard');
  });

  it('preserves the given apiHost verbatim (provisioning may return a non-canonical host)', () => {
    // Trailing slash and all — the task-stream destination relies on this so its
    // own normalization is exercised.
    const h = HostResolution.fromApiHost('https://us.posthog.com/');
    expect(h.apiHost).toBe('https://us.posthog.com/');
  });

  it('points everything at the local stack for a localhost host', () => {
    const h = HostResolution.fromApiHost('http://localhost:8010');
    expect(h.region).toBe('us');
    expect(h.apiHost).toBe('http://localhost:8010');
    expect(h.appHost).toBe('http://localhost:8010');
    expect(h.gatewayUrl).toBe('http://localhost:3308/wizard');
  });
});

describe('HostResolution mcpUrl', () => {
  it('defaults to the region-independent prod MCP url, pinned to cli mode', () => {
    expect(HostResolution.fromApiHost('https://us.i.posthog.com').mcpUrl).toBe(
      'https://mcp.posthog.com/mcp?mode=cli',
    );
    expect(HostResolution.fromApiHost('https://eu.i.posthog.com').mcpUrl).toBe(
      'https://mcp.posthog.com/mcp?mode=cli',
    );
  });

  it('points at the local MCP server when localMcp is set', () => {
    const h = HostResolution.fromApiHost('https://us.i.posthog.com', {
      localMcp: true,
    });
    expect(h.mcpUrl).toBe('http://localhost:8787/mcp?mode=cli');
  });
});

describe('HostResolution immutability', () => {
  it('is frozen and rejects mutation', () => {
    const h = HostResolution.fromApiHost('https://us.i.posthog.com');
    expect(Object.isFrozen(h)).toBe(true);
    expect(() => {
      (h as unknown as { apiHost: string }).apiHost = 'https://evil.example';
    }).toThrow();
  });
});

describe('HostResolution.fromAccessToken', () => {
  it('short-circuits to us in dev/test without a network probe', async () => {
    const h = await HostResolution.fromAccessToken('any-token');
    expect(h.region).toBe('us');
  });
});

/** Run `fn` with an env var pinned, restoring the prior value afterwards. */
function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

describe('mcpUrlFor', () => {
  it('builds the bare prod url when no mode is requested (server default)', () => {
    expect(mcpUrlFor()).toBe('https://mcp.posthog.com/mcp');
    expect(mcpUrlFor({})).toBe('https://mcp.posthog.com/mcp');
  });

  it('pins the requested mode on the prod url', () => {
    expect(mcpUrlFor({ mode: 'tools' })).toBe(
      'https://mcp.posthog.com/mcp?mode=tools',
    );
    expect(mcpUrlFor({ mode: 'cli' })).toBe(
      'https://mcp.posthog.com/mcp?mode=cli',
    );
  });

  it('pins the requested mode on the local dev url', () => {
    expect(mcpUrlFor({ local: true, mode: 'tools' })).toBe(
      'http://localhost:8787/mcp?mode=tools',
    );
    expect(mcpUrlFor({ local: true })).toBe('http://localhost:8787/mcp');
  });

  it('adds a features filter, before the mode param', () => {
    expect(mcpUrlFor({ features: ['dashboards', 'insights'] })).toBe(
      'https://mcp.posthog.com/mcp?features=dashboards,insights',
    );
    expect(mcpUrlFor({ features: ['dashboards'], mode: 'tools' })).toBe(
      'https://mcp.posthog.com/mcp?features=dashboards&mode=tools',
    );
    expect(mcpUrlFor({ features: [] })).toBe('https://mcp.posthog.com/mcp');
  });

  it('takes an MCP_URL override verbatim', () => {
    withEnv('MCP_URL', 'https://mcp.example.com/mcp?mode=cli', () => {
      expect(mcpUrlFor({ mode: 'tools' })).toBe(
        'https://mcp.example.com/mcp?mode=cli',
      );
    });
  });

  it('prefers the local dev server over an MCP_URL override', () => {
    withEnv('MCP_URL', 'https://mcp.example.com/mcp', () => {
      expect(mcpUrlFor({ local: true, mode: 'tools' })).toBe(
        'http://localhost:8787/mcp?mode=tools',
      );
    });
  });

  it('lets the POSTHOG_WIZARD_MCP_MODE kill switch win over the requested mode', () => {
    withEnv('POSTHOG_WIZARD_MCP_MODE', 'cli', () => {
      expect(mcpUrlFor({ mode: 'tools' })).toBe(
        'https://mcp.posthog.com/mcp?mode=cli',
      );
    });
    withEnv('POSTHOG_WIZARD_MCP_MODE', 'tools', () => {
      expect(mcpUrlFor()).toBe('https://mcp.posthog.com/mcp?mode=tools');
      expect(mcpUrlFor({ local: true, mode: 'cli' })).toBe(
        'http://localhost:8787/mcp?mode=tools',
      );
    });
  });

  it('ignores an invalid POSTHOG_WIZARD_MCP_MODE value', () => {
    withEnv('POSTHOG_WIZARD_MCP_MODE', 'bogus', () => {
      expect(mcpUrlFor({ mode: 'tools' })).toBe(
        'https://mcp.posthog.com/mcp?mode=tools',
      );
    });
  });
});

describe('mcpModeFromUrl', () => {
  it('reads a pinned mode off the url', () => {
    expect(mcpModeFromUrl('https://mcp.posthog.com/mcp?mode=tools')).toBe(
      'tools',
    );
    expect(mcpModeFromUrl('http://localhost:8787/mcp?mode=cli')).toBe('cli');
    expect(
      mcpModeFromUrl(
        'https://mcp.posthog.com/mcp?features=insights&mode=tools',
      ),
    ).toBe('tools');
  });

  it('resolves to the server default (cli) when no mode is pinned', () => {
    expect(mcpModeFromUrl('https://mcp.posthog.com/mcp')).toBe('cli');
    expect(mcpModeFromUrl('https://mcp.posthog.com/mcp?features=sql')).toBe(
      'cli',
    );
    expect(mcpModeFromUrl('not a url')).toBe('cli');
  });
});
