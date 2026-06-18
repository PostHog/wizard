import { MCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import { BrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';
import { openTrackedLink } from '@utils/links';

/**
 * Claude Desktop / Claude.ai (web). PostHog ships here as a hosted connector,
 * not a local config — so instead of writing files we open the connector
 * directory page and let the user sign in and click "Connect".
 */
export class ClaudeWebMCPClient extends MCPClient implements BrowserFinishable {
  name = 'Claude Desktop/Web';
  connectorUrl = 'https://claude.ai/directory/connectors/posthog';
  finishInstruction = 'Sign in and click "Connect" to finish.';

  isClientSupported(): Promise<boolean> {
    // Browser-based — available on every platform.
    return Promise.resolve(true);
  }

  isServerInstalled(): Promise<boolean> {
    // The connector lives in the user's Claude account; nothing local to
    // inspect. Returning false also keeps it out of `mcp remove`.
    return Promise.resolve(false);
  }

  addServer(): Promise<{ success: boolean }> {
    // Not a PostHog property, so no UTMs — just the tracked open.
    openTrackedLink(this.connectorUrl, 'claude-web-connector', {
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

export default ClaudeWebMCPClient;
