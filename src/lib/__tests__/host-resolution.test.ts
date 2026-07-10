import { describe, it, expect } from 'vitest';
import { HostResolution, mcpUrlFor } from '@lib/host-resolution';

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
  it('defaults to the region-independent prod MCP url (server serves cli mode)', () => {
    expect(HostResolution.fromApiHost('https://us.i.posthog.com').mcpUrl).toBe(
      'https://mcp.posthog.com/mcp',
    );
    expect(HostResolution.fromApiHost('https://eu.i.posthog.com').mcpUrl).toBe(
      'https://mcp.posthog.com/mcp',
    );
  });

  it('points at the local MCP server when localMcp is set', () => {
    const h = HostResolution.fromApiHost('https://us.i.posthog.com', {
      localMcp: true,
    });
    expect(h.mcpUrl).toBe('http://localhost:8787/mcp');
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

describe('mcpUrlFor', () => {
  it('builds the bare prod url (server serves the wizard cli mode)', () => {
    expect(mcpUrlFor(false)).toBe('https://mcp.posthog.com/mcp');
  });

  it('builds the bare local dev url', () => {
    expect(mcpUrlFor(true)).toBe('http://localhost:8787/mcp');
  });

  it('takes an MCP_URL override verbatim', () => {
    const prev = process.env.MCP_URL;
    process.env.MCP_URL = 'https://mcp.example.com/mcp?mode=cli';
    try {
      expect(mcpUrlFor(false)).toBe('https://mcp.example.com/mcp?mode=cli');
    } finally {
      if (prev === undefined) delete process.env.MCP_URL;
      else process.env.MCP_URL = prev;
    }
  });
});
