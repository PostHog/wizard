import { MCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import { BrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';
import { openTrackedLink } from '@utils/links';

/**
 * Grok (grok.com, by xAI). Grok connects custom MCP servers through its hosted
 * Connectors page, not a local config or CLI. So instead of writing files we
 * open the connectors page and let the user add a custom connector pointing at
 * the PostHog MCP server URL.
 */
export class GrokMCPClient extends MCPClient implements BrowserFinishable {
  name = 'Grok';
  connectorUrl = 'https://grok.com/connectors';
  finishInstruction =
    'Click "New Connector" → "Custom", paste https://mcp.posthog.com/mcp as the MCP server URL, and connect.';

  isClientSupported(): Promise<boolean> {
    // Browser-based — available on every platform.
    return Promise.resolve(true);
  }

  isServerInstalled(): Promise<boolean> {
    // The connector lives in the user's Grok account; nothing local to
    // inspect. Returning false also keeps it out of `mcp remove`.
    return Promise.resolve(false);
  }

  addServer(): Promise<{ success: boolean }> {
    // Not a PostHog property, so no UTMs — just the tracked open.
    openTrackedLink(this.connectorUrl, 'grok-connector', {
      auto: true,
      skipUtm: true,
    });
    return Promise.resolve({ success: true });
  }

  removeServer(): Promise<{ success: boolean }> {
    return Promise.resolve({ success: false });
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  getServerPropertyName(): string {
    throw new Error('Not implemented');
  }
}

export default GrokMCPClient;
