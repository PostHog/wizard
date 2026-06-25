import { MCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import { BrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';
import { openTrackedLink } from '@utils/links';

/**
 * LibreChat (librechat.ai). LibreChat is self-hosted and configured via a YAML
 * file (`librechat.yaml`) whose location varies per deployment, so there's no
 * universal local config path we can safely rewrite (the other config-file
 * clients here are JSON). Newer LibreChat versions can add MCP servers from the
 * in-app MCP Settings panel without editing YAML, so we follow the
 * browser-finishable pattern: open the MCP docs and let the user add a
 * streamable-http server pointing at the PostHog MCP server URL.
 */
export class LibreChatMCPClient extends MCPClient implements BrowserFinishable {
  name = 'LibreChat';
  connectorUrl = 'https://www.librechat.ai/docs/features/mcp';
  finishInstruction =
    'In LibreChat → MCP Settings, add a streamable-http server with URL https://mcp.posthog.com/mcp.';

  isClientSupported(): Promise<boolean> {
    // Self-hosted and browser-based — available on every platform.
    return Promise.resolve(true);
  }

  isServerInstalled(): Promise<boolean> {
    // Config lives in the user's own LibreChat deployment; nothing local to
    // inspect. Returning false also keeps it out of `mcp remove`.
    return Promise.resolve(false);
  }

  addServer(): Promise<{ success: boolean }> {
    // Not a PostHog property, so no UTMs — just the tracked open.
    openTrackedLink(this.connectorUrl, 'librechat-connector', {
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

export default LibreChatMCPClient;
