import {
  buildMCPUrl,
  getDefaultServerConfig,
  getNativeHTTPServerConfig,
} from '@steps/add-mcp-server-to-clients/defaults';

describe('defaults', () => {
  describe('buildMCPUrl', () => {
    it('should build base URL', () => {
      const url = buildMCPUrl();
      expect(url).toBe('https://mcp.posthog.com/mcp');
    });

    it('should use localhost for local mode', () => {
      const url = buildMCPUrl(undefined, true);
      expect(url).toBe('http://localhost:8787/mcp');
    });

    it('should add features param when not all features selected', () => {
      const url = buildMCPUrl(['dashboards', 'insights']);
      expect(url).toBe(
        'https://mcp.posthog.com/mcp?features=dashboards,insights',
      );
    });
  });

  describe('getDefaultServerConfig', () => {
    it("should return a credential-free mcp-remote config (auth is the client's job)", () => {
      const config = getDefaultServerConfig();
      expect(config).toEqual({
        command: 'npx',
        args: ['-y', 'mcp-remote@latest', 'https://mcp.posthog.com/mcp'],
      });
      expect(config).not.toHaveProperty('env');
    });

    it('should encode the feature selection in the URL', () => {
      const config = getDefaultServerConfig(['workflows']);
      expect(config.args).toContain(
        'https://mcp.posthog.com/mcp?features=workflows',
      );
    });
  });

  describe('getNativeHTTPServerConfig', () => {
    it("should return a URL-only config with no headers (auth is the client's job)", () => {
      const config = getNativeHTTPServerConfig();
      expect(config).toEqual({
        url: 'https://mcp.posthog.com/mcp',
      });
      expect(config).not.toHaveProperty('headers');
    });

    it('should encode the feature selection in the URL', () => {
      const config = getNativeHTTPServerConfig(['workflows']);
      expect(config.url).toBe('https://mcp.posthog.com/mcp?features=workflows');
    });
  });
});
