import {
  buildMCPUrl,
  getDefaultServerConfig,
  getNativeHTTPServerConfig,
} from '../defaults';

describe('defaults', () => {
  describe('buildMCPUrl', () => {
    it('should build base URL for streamable-http type', () => {
      const url = buildMCPUrl('streamable-http');
      expect(url).toBe('https://mcp.posthog.com/mcp');
    });

    it('should build base URL for sse type', () => {
      const url = buildMCPUrl('sse');
      expect(url).toBe('https://mcp.posthog.com/sse');
    });

    it('should use localhost for local mode', () => {
      const url = buildMCPUrl('streamable-http', undefined, true);
      expect(url).toBe('http://localhost:8787/mcp');
    });

    it('should add features param when not all features selected', () => {
      const url = buildMCPUrl('streamable-http', ['dashboards', 'insights']);
      expect(url).toBe(
        'https://mcp.posthog.com/mcp?features=dashboards,insights',
      );
    });

    it('should add region param for EU region', () => {
      const url = buildMCPUrl('streamable-http', undefined, false, 'eu');
      expect(url).toBe('https://mcp.posthog.com/mcp?region=eu');
    });

    it('should not add region param for US region (default)', () => {
      const url = buildMCPUrl('streamable-http', undefined, false, 'us');
      expect(url).toBe('https://mcp.posthog.com/mcp');
    });

    it('should not add region param in local mode', () => {
      const url = buildMCPUrl('streamable-http', undefined, true, 'eu');
      expect(url).toBe('http://localhost:8787/mcp');
    });

    it('should combine features and region params', () => {
      const url = buildMCPUrl('streamable-http', ['dashboards'], false, 'eu');
      expect(url).toBe(
        'https://mcp.posthog.com/mcp?features=dashboards&region=eu',
      );
    });
  });

  describe('getDefaultServerConfig', () => {
    it('should return config with auth header when API key provided', () => {
      const config = getDefaultServerConfig('phx_test123', 'sse');
      expect(config).toEqual({
        command: 'npx',
        args: [
          '-y',
          'mcp-remote@latest',
          'https://mcp.posthog.com/sse',
          '--header',
          'Authorization:${POSTHOG_AUTH_HEADER}',
        ],
        env: {
          POSTHOG_AUTH_HEADER: 'Bearer phx_test123',
        },
      });
    });

    it('should return config without auth header for OAuth mode (no API key)', () => {
      const config = getDefaultServerConfig(undefined, 'sse');
      expect(config).toEqual({
        command: 'npx',
        args: ['-y', 'mcp-remote@latest', 'https://mcp.posthog.com/sse'],
      });
      expect(config).not.toHaveProperty('env');
    });

    it('should include region in URL for EU users in OAuth mode', () => {
      const config = getDefaultServerConfig(
        undefined,
        'streamable-http',
        undefined,
        false,
        'eu',
      );
      expect(config.args).toContain('https://mcp.posthog.com/mcp?region=eu');
    });
  });

  describe('getNativeHTTPServerConfig', () => {
    it('should return config with headers when API key provided', () => {
      const config = getNativeHTTPServerConfig(
        'phx_test123',
        'streamable-http',
      );
      expect(config).toEqual({
        url: 'https://mcp.posthog.com/mcp',
        headers: {
          Authorization: 'Bearer phx_test123',
        },
      });
    });

    it('should return config without headers for OAuth mode (no API key)', () => {
      const config = getNativeHTTPServerConfig(undefined, 'streamable-http');
      expect(config).toEqual({
        url: 'https://mcp.posthog.com/mcp',
      });
      expect(config).not.toHaveProperty('headers');
    });

    it('should include region in URL for EU users', () => {
      const config = getNativeHTTPServerConfig(
        undefined,
        'streamable-http',
        undefined,
        false,
        'eu',
      );
      expect(config.url).toBe('https://mcp.posthog.com/mcp?region=eu');
    });
  });
});
