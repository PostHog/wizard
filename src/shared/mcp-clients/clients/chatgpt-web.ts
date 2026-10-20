import { MCPClient } from '@shared/mcp-clients/MCPClient';
import type { InstallResult } from '@shared/mcp-clients/results';
import { BrowserFinishable } from '@shared/mcp-clients/browser-client';
import { openTrackedLink } from '@utils/links';

/**
 * ChatGPT (web and desktop). PostHog ships here as a listing in the ChatGPT
 * plugin directory, installed into the user's ChatGPT account — so instead of
 * writing files we open the listing and let the user install and connect it.
 */
export class ChatGptWebMCPClient
  extends MCPClient
  implements BrowserFinishable
{
  name = 'ChatGPT';
  connectorUrl =
    'https://chatgpt.com/plugins/plugin_asdk_app_699caef2d680819188727b0ddbb349dd';
  finishInstruction = 'Press + to install, then connect PostHog when asked.';

  isClientSupported(): Promise<boolean> {
    // Browser-based — available on every platform.
    return Promise.resolve(true);
  }

  isServerInstalled(): Promise<boolean> {
    // The plugin lives in the user's ChatGPT account; nothing local to
    // inspect. Returning false also keeps it out of `mcp remove`.
    return Promise.resolve(false);
  }

  addServer(): Promise<InstallResult> {
    // Not a PostHog property, so no UTMs — just the tracked open.
    openTrackedLink(this.connectorUrl, 'chatgpt-plugin', {
      auto: true,
      skipUtm: true,
    });
    return Promise.resolve({ success: true });
  }

  removeServer(): Promise<InstallResult> {
    // Never reached today (isServerInstalled is always false), but say where
    // to go if it ever is.
    return Promise.resolve({
      success: false,
      reason:
        'This plugin is managed in your ChatGPT account — remove it from the Plugins tab in ChatGPT.',
    });
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  getServerPropertyName(): string {
    throw new Error('Not implemented');
  }
}

export default ChatGptWebMCPClient;
