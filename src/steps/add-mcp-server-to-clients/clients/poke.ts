import { MCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import { BrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';
import { openTrackedLink } from '@utils/links';

/**
 * Poke (poke.com, by The Interaction Company). Poke is a hosted assistant —
 * MCP servers are connected through its web app, not a local config or CLI.
 * So instead of writing files we open the "new integration" page and let the
 * user paste the PostHog MCP server URL and click "Create Integration".
 */
export class PokeMCPClient extends MCPClient implements BrowserFinishable {
  name = 'Poke';
  connectorUrl = 'https://poke.com/settings/connections/integrations/new';
  finishInstruction =
    'Paste https://mcp.posthog.com/mcp as the MCP server URL and click "Create Integration".';

  isClientSupported(): Promise<boolean> {
    // Browser-based — available on every platform.
    return Promise.resolve(true);
  }

  isServerInstalled(): Promise<boolean> {
    // The integration lives in the user's Poke account; nothing local to
    // inspect. Returning false also keeps it out of `mcp remove`.
    return Promise.resolve(false);
  }

  addServer(): Promise<{ success: boolean }> {
    // Not a PostHog property, so no UTMs — just the tracked open.
    openTrackedLink(this.connectorUrl, 'poke-connector', {
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

export default PokeMCPClient;
